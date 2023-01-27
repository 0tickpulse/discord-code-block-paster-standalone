var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import token from "./config/token.json" assert { type: "json" };
import configuration from "./config/config.json" assert { type: "json" };
import { Client, GatewayIntentBits } from "discord.js";
import { marked } from "marked";
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.MessageContent],
});
client.login(token.token);
export function hasteBin(text, language = "txt") {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield fetch(`${configuration.hastebinUrl}/documents`, {
            method: "POST",
            body: text,
        });
        const json = yield response.json();
        return `${configuration.hastebinUrl}/${json.key}.${language}`;
    });
}
function findCodeBlocksInToken(token) {
    var _a;
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
        const codeBlocks = [];
        for (const cell of token.rows.flat()) {
            for (const subToken of cell.tokens) {
                codeBlocks.push(...findCodeBlocksInToken(subToken));
            }
        }
        return codeBlocks;
    }
    if (token.type === "list") {
        const codeBlocks = [];
        for (const item of token.items) {
            codeBlocks.push(...findCodeBlocksInToken(item));
        }
        return codeBlocks;
    }
    if ("tokens" in token) {
        const codeBlocks = [];
        for (const subToken of (_a = token.tokens) !== null && _a !== void 0 ? _a : []) {
            codeBlocks.push(...findCodeBlocksInToken(subToken));
        }
        return codeBlocks;
    }
    return [];
}
function findCodeBlocksInString(source) {
    const tokens = marked.lexer(source);
    const codeBlocks = [];
    for (const token of tokens) {
        codeBlocks.push(...findCodeBlocksInToken(token));
    }
    return codeBlocks;
}
function getPasteInfo(config, message) {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function* () {
        const codeBlocks = findCodeBlocksInString(message.content).filter((block) => block.text.split("\n").length >= config.minLines.codeBlock);
        const attachments = message.attachments.filter((attachment) => { var _a; return config.contentTypes.includes((_a = attachment.contentType) !== null && _a !== void 0 ? _a : ""); });
        for (const attachment of attachments) {
            const text = yield fetch(attachment[1].url).then((response) => response.text());
            if (text.split("\n").length < config.minLines.attachment) {
                continue;
            }
            codeBlocks.push({
                text,
                language: (_b = (_a = attachment[1].name) === null || _a === void 0 ? void 0 : _a.split(".").pop()) !== null && _b !== void 0 ? _b : undefined,
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
    });
}
function reply(config, message, user) {
    return __awaiter(this, void 0, void 0, function* () {
        const { codeBlocks } = yield getPasteInfo(config, message);
        const hastebinUrls = yield Promise.all(codeBlocks.map((codeBlock) => hasteBin(codeBlock.text, codeBlock.language)));
        const embed = {
            title: `Pastes`,
            description: hastebinUrls.map((url, index) => `[Link ${index + 1}](${url})`).join("\n"),
        };
        return yield message.reply({
            content: `<@${user.id}>`,
            embeds: [embed],
            allowedMentions: {
                repliedUser: user.id === message.author.id,
            },
        });
    });
}
client.on("messageCreate", (message) => __awaiter(void 0, void 0, void 0, function* () {
    console.log("codeBlockPaster");
    if ((yield getPasteInfo(configuration, message)).cancel) {
        console.log("codeBlockPaster cancel");
        return;
    }
    yield message.react("📋");
    let reactedMessage;
    client.on("messageReactionAdd", (reaction, user) => __awaiter(void 0, void 0, void 0, function* () {
        if (reactedMessage !== undefined) {
            yield reaction.message.reply({
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
        yield reaction.users.remove(user.id);
        if (reaction.emoji.name === "📋" && reaction.message.id === message.id) {
            reactedMessage = yield reply(configuration, message, user);
        }
    }));
}));
