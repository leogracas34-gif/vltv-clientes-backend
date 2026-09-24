const path = require('path');
const QRCode = require('qrcode');
const pino = require('pino');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
} = require('@whiskeysockets/baileys');

const { enviarMensagemAdmin, enviarFotoAdmin } = require('../telegram');
const fila = require('./fila');

const PASTA_SESSAO = path.join(__dirname, '..', '..', 'auth_info_baileys');

let socketAtual = null;
let conectado = false;

async function iniciarConexao() {
    const { state, saveCreds } = await useMultiFileAuthState(PASTA_SESSAO);

    const socket = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }), // deixa o log do proprio Baileys quieto - usamos os nossos
        printQRInTerminal: false, // vamos mandar o QR pro Telegram em vez do terminal
    });

    socketAtual = socket;

    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('[WHATSAPP] QR code gerado - enviando para o Telegram...');
            try {
                const bufferPng = await QRCode.toBuffer(qr, { width: 400 });
                await enviarFotoAdmin(
                    bufferPng,
                    '📱 Escaneie este QR code no WhatsApp (Aparelhos conectados) para ativar o bot.'
                );
            } catch (erro) {
                console.error('[WHATSAPP] Erro ao gerar/enviar QR code:', erro.message);
            }
        }

        if (connection === 'open') {
            conectado = true;
            console.log('[WHATSAPP] Conectado com sucesso.');
            fila.setFuncaoDeEnvio(enviarMensagemDireta);
            enviarMensagemAdmin('✅ Bot do WhatsApp conectado e pronto pra enviar avisos.');
        }

        if (connection === 'close') {
            conectado = false;
            const codigoErro = lastDisconnect?.error?.output?.statusCode;
            const deveReconectar = codigoErro !== DisconnectReason.loggedOut;

            console.warn(
                `[WHATSAPP] Conexao fechada (codigo ${codigoErro}). Reconectar? ${deveReconectar}`
            );

            if (deveReconectar) {
                // Pequena espera antes de tentar de novo, pra nao ficar em loop
                // agressivo caso o problema seja algo persistente (ex: sem internet).
                setTimeout(() => iniciarConexao(), 5000);
            } else {
                await enviarMensagemAdmin(
                    '🔴 O WhatsApp foi desconectado (logout). Vai ser preciso escanear o QR code de novo - ' +
                    'reinicie o processo do bot na VPS pra gerar um novo QR.'
                );
            }
        }
    });

    return socket;
}

// Funcao "crua" de envio - so e chamada pela fila (fila.js), nunca direto,
// pra garantir que sempre passa pelo throttle/retry.
async function enviarMensagemDireta(telefoneComDDI, texto) {
    if (!socketAtual || !conectado) {
        throw new Error('WhatsApp nao esta conectado no momento.');
    }
    const jid = `${telefoneComDDI}@s.whatsapp.net`;
    await socketAtual.sendMessage(jid, { text: texto });
}

// Ponto de entrada usado pelo resto do sistema (cron, rotas da API) -
// so adiciona na fila, nunca envia direto.
function enviarMensagem(telefoneComDDI, texto) {
    fila.adicionar(telefoneComDDI, texto);
}

function estaConectado() {
    return conectado;
}

module.exports = { iniciarConexao, enviarMensagem, estaConectado };
