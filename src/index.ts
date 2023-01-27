import token from "./config/token.json" assert { type: "json" };
import configuration from "./config/config.json" assert { type: "json" };
import { APIEmbed, Client, GatewayIntentBits, Message, PartialMessage, PartialUser, User } from "discord.js";
import { marked } from "marked";

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.MessageContent],
});

client.login(token.token);

type CodeBlock = {
    text: string;
    language?: string;
};

export async function hasteBin(text: string, language = "txt") {
    const response = await fetch(`${configuration.hastebinUrl}/documents`, {
        method: "POST",
        body: text,
    });
    const json = await response.json();
    return `${configuration.hastebinUrl}/${json.key}.${language}`;
}

function findCodeBlocksInToken(token: marked.Token): CodeBlock[] {
    if (token.type === "code") {
        return [
            {
                text: token.text,
                language: token.lang,
            },
        ];
    }
    if (token.type === "codespan") {
        return [
            {
                text: token.text,
                language: undefined,
            },
        ];
    }
    if (token.type === "table") {
        const codeBlocks: CodeBlock[] = [];
        for (const cell of token.rows.flat()) {
            for (const subToken of cell.tokens) {
                codeBlocks.push(...findCodeBlocksInToken(subToken));
            }
        }
        return codeBlocks;
    }
    if (token.type === "list") {
        const codeBlocks: CodeBlock[] = [];
        for (const item of token.items) {
            codeBlocks.push(...findCodeBlocksInToken(item));
        }
        return codeBlocks;
    }
    if ("tokens" in token) {
        const codeBlocks: CodeBlock[] = [];
        for (const subToken of token.tokens ?? []) {
            codeBlocks.push(...findCodeBlocksInToken(subToken));
        }
        return codeBlocks;
    }
    return [];
}

function findCodeBlocksInString(source: string) {
    const tokens = marked.lexer(source);
    const codeBlocks: CodeBlock[] = [];
    for (const token of tokens) {
        codeBlocks.push(...findCodeBlocksInToken(token));
    }
    return codeBlocks;
}

async function getPasteInfo(
    config: typeof configuration,
    message: Message<boolean>,
): Promise<{
    codeBlocks: CodeBlock[];
    cancel: boolean;
}> {
    const codeBlocks = findCodeBlocksInString(message.content).filter((block) => block.text.split("\n").length >= config.minLines.codeBlock);
    const attachments = message.attachments.filter((attachment) => config.contentTypes.includes(attachment.contentType ?? ""));
    for (const attachment of attachments) {
        const text = await fetch(attachment[1].url).then((response) => response.text());
        if (text.split("\n").length < config.minLines.attachment) {
            continue;
        }
        codeBlocks.push({
            text,
            language: attachment[1].name?.split(".").pop() ?? undefined,
        });
    }
    if (codeBlocks.length === 0) {
        return {
            codeBlocks: [],
            cancel: true,
        };
    }
    return {
        codeBlocks,
        cancel: false,
    };
}

async function reply(config: typeof configuration, message: Message<boolean>, user: User | PartialUser) {
    const { codeBlocks } = await getPasteInfo(config, message);
    const hastebinUrls = await Promise.all(codeBlocks.map((codeBlock) => hasteBin(codeBlock.text, codeBlock.language)));
    const embed: APIEmbed = {
        title: `Pastes`,
        description: hastebinUrls.map((url, index) => `[Link ${index + 1}](${url})`).join("\n"),
    };
    return await message.reply({
        content: `<@${user.id}>`,
        embeds: [embed],
        allowedMentions: {
            repliedUser: user.id === message.author.id,
        },
    });
}

client.on("messageCreate", async (message) => {
    console.log("codeBlockPaster");
    if ((await getPasteInfo(configuration, message)).cancel) {
        console.log("codeBlockPaster cancel");
        return;
    }

    await message.react("📋");

    let reactedMessage: Message<boolean> | PartialMessage | undefined;

    client.on("messageReactionAdd", async (reaction, user) => {
        if (reactedMessage !== undefined) {
            await reaction.message.reply({
                content: `<@${user.id}>`,
                embeds: [
                    {
                        description: `A paste has already been created for this message. [Link](${reactedMessage.url})`,
                    },
                ],
                allowedMentions: {
                    repliedUser: user.id === message.author.id,
                },
            });
            return;
        }
        if (user.bot) {
            return;
        }
        await reaction.users.remove(user.id);
        if (reaction.emoji.name === "📋" && reaction.message.id === message.id) {
            reactedMessage = await reply(configuration, message, user);
        }
    });
});
