const axios = require('axios');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function enviarMensagemAdmin(texto) {
    if (!TOKEN || !CHAT_ID) {
        console.warn('[TELEGRAM] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID nao configurados - aviso nao enviado:', texto);
        return;
    }

    try {
        await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: texto,
            parse_mode: 'HTML',
        });
    } catch (erro) {
        console.error('[TELEGRAM] Falha ao enviar mensagem:', erro.message);
    }
}

// Usado pra mandar a imagem do QR Code do WhatsApp direto no Telegram,
// assim voce nao precisa ficar olhando o terminal da VPS pelo celular.
async function enviarFotoAdmin(bufferPng, legenda) {
    if (!TOKEN || !CHAT_ID) {
        console.warn('[TELEGRAM] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID nao configurados - QR nao enviado.');
        return;
    }

    try {
        const FormData = require('form-data');
        const form = new FormData();
        form.append('chat_id', CHAT_ID);
        form.append('caption', legenda || '');
        form.append('photo', bufferPng, { filename: 'qrcode.png', contentType: 'image/png' });

        await axios.post(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, form, {
            headers: form.getHeaders(),
        });
    } catch (erro) {
        console.error('[TELEGRAM] Falha ao enviar QR code:', erro.message);
    }
}

module.exports = { enviarMensagemAdmin, enviarFotoAdmin };
