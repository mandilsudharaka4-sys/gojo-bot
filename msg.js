const { proto, downloadContentFromMessage, getContentType } = require('baileys": "npm:baileyz@latest"');
const fs = require('fs');

const downloadMediaMessage = async (message, filename) => {
    if (!message) return null;
    
    let messageType = Object.keys(message)[0];
    let stream = await downloadContentFromMessage(message[messageType], messageType.replace('Message', ''));
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }
    
    let fileExtension = '';
    if (messageType === 'imageMessage') fileExtension = '.jpg';
    else if (messageType === 'videoMessage') fileExtension = '.mp4';
    else if (messageType === 'audioMessage') fileExtension = '.mp3';
    else if (messageType === 'documentMessage') fileExtension = '.pdf';
    
    const fullPath = filename + fileExtension;
    fs.writeFileSync(fullPath, buffer);
    return fullPath;
};

const sms = (socket, msg) => {
    const from = msg.key.remoteJid;
    const isGroup = from.endsWith('@g.us');
    const sender = msg.key.participant || from;
    const userJid = socket.user.id.split(':')[0] + '@s.whatsapp.net';
    
    const getMessageType = () => {
        if (msg.message?.conversation) return 'text';
        if (msg.message?.extendedTextMessage) return 'text';
        if (msg.message?.imageMessage) return 'image';
        if (msg.message?.videoMessage) return 'video';
        if (msg.message?.audioMessage) return 'audio';
        if (msg.message?.documentMessage) return 'document';
        if (msg.message?.stickerMessage) return 'sticker';
        return 'unknown';
    };
    
    const getText = () => {
        if (msg.message?.conversation) return msg.message.conversation;
        if (msg.message?.extendedTextMessage?.text) return msg.message.extendedTextMessage.text;
        if (msg.message?.imageMessage?.caption) return msg.message.imageMessage.caption;
        if (msg.message?.videoMessage?.caption) return msg.message.videoMessage.caption;
        return '';
    };
    
    const reply = async (text, options = {}) => {
        const quoted = options.quoted || msg;
        return await socket.sendMessage(from, { text }, { quoted });
    };
    
    const sendMessage = async (jid, content, options = {}) => {
        return await socket.sendMessage(jid, content, options);
    };
    
    const sendImage = async (jid, image, caption, options = {}) => {
        return await socket.sendMessage(jid, { image, caption }, options);
    };
    
    const sendVideo = async (jid, video, caption, options = {}) => {
        return await socket.sendMessage(jid, { video, caption }, options);
    };
    
    const sendAudio = async (jid, audio, ptt = false, options = {}) => {
        return await socket.sendMessage(jid, { audio, mimetype: 'audio/mpeg', ptt }, options);
    };
    
    const sendDocument = async (jid, document, filename, caption, options = {}) => {
        return await socket.sendMessage(jid, { document, fileName: filename, caption }, options);
    };
    
    const sendSticker = async (jid, sticker, options = {}) => {
        return await socket.sendMessage(jid, { sticker }, options);
    };
    
    const react = async (emoji) => {
        return await socket.sendMessage(from, { react: { text: emoji, key: msg.key } });
    };
    
    const download = async (messageType, filename) => {
        return await downloadMediaMessage(messageType, filename);
    };
    
    return {
        chat: from,
        from: sender,
        isGroup,
        body: getText(),
        type: getMessageType(),
        message: msg,
        reply,
        sendMessage,
        sendImage,
        sendVideo,
        sendAudio,
        sendDocument,
        sendSticker,
        react,
        download,
        socket
    };
};

module.exports = { sms, downloadMediaMessage };