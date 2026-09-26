import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import pino from 'pino';

import {
    default as makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion,
    DisconnectReason,
} from '@whiskeysockets/baileys';

import { enviarMensagemAdmin, enviarFotoAdmin } from '../telegram/index.js';
import fila from './fila.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PASTA_SESSAO = path.join(__dirname, '..', '..', 'auth_info_baileys');

// Imagem do QR Code do Pix (estático, sem valor) - opcional. Se o arquivo
// nao existir, o bot simplesmente manda a mensagem só em texto, sem quebrar
// nada. Coloque o arquivo em assets/pix-qrcode.png na raiz do projeto.
const CAMINHO_QR_PIX = path.join(__dirname, '..', '..', 'assets', 'pix-qrcode.png');

// Código "Pix Copia e Cola" correspondente ao QR acima - configurado via
// .env (PIX_COPIA_COLA=...) pra poder trocar sem mexer em código. Se vazio,
// essa parte é simplesmente omitida da mensagem.
const PIX_COPIA_COLA = (process.env.PIX_COPIA_COLA || '').trim();

// ✅ NOVO (migracao pro Baileys 7): a atualizacao pro Baileys 7 migra as
// sessoes salvas pro novo formato (LID) de forma IRREVERSIVEL - uma vez
// que o Baileys 7 abre e regrava a pasta de sessao, nao da mais pra voltar
// pra uma versao 6.x apontando pra essa mesma pasta. Por seguranca, antes
// de abrir a conexao pela primeira vez nessa versao, fazemos UMA copia de
// backup da pasta como ela estava antes da migracao (so na primeira vez -
// nunca sobrescreve um backup que ja existe).
const PASTA_BACKUP_PRE_V7 = path.join(__dirname, '..', '..', 'auth_info_baileys_backup_pre_v7');

function fazerBackupSessaoSeNecessario() {
    try {
        if (fs.existsSync(PASTA_SESSAO) && !fs.existsSync(PASTA_BACKUP_PRE_V7)) {
            fs.cpSync(PASTA_SESSAO, PASTA_BACKUP_PRE_V7, { recursive: true });
            console.log(
                `[WHATSAPP] Backup da sessao pre-Baileys-7 criado em ${PASTA_BACKUP_PRE_V7} ` +
                '(a migracao de formato do Baileys 7 nao tem volta - guarde esse backup).'
            );
        }
    } catch (erro) {
        console.error('[WHATSAPP] Falha ao criar backup da sessao antes da migracao:', erro.message);
    }
}

let socketAtual = null;
let conectado = false;

async function iniciarConexao() {
    fazerBackupSessaoSeNecessario();

    const { state, saveCreds } = await useMultiFileAuthState(PASTA_SESSAO);

    // ✅ NOVO: busca a versao atual do protocolo do WhatsApp Web em vez de
    // usar a versao fixa que vem embutida na biblioteca. O WhatsApp muda
    // esse numero de vez em quando, e quando isso acontece o Baileys leva
    // um tempo pra lancar uma atualizacao com o numero novo - enquanto
    // isso, quem usa a versao antiga embutida toma "405 Method Not
    // Allowed" na hora de conectar (foi exatamente isso que aconteceu
    // aqui). Buscando a versao mais recente toda vez que o bot sobe, a
    // gente para de depender de quando a lib em si e atualizada.
    let versaoProtocolo;
    try {
        const { version } = await fetchLatestBaileysVersion();
        versaoProtocolo = version;
        console.log(`[WHATSAPP] Versao do protocolo WhatsApp Web em uso: ${version.join('.')}`);
    } catch (erro) {
        console.warn(
            '[WHATSAPP] Nao foi possivel buscar a versao mais recente do protocolo ' +
            `(${erro.message}) - usando a versao padrao embutida na biblioteca.`
        );
    }

    const socket = makeWASocket({
        version: versaoProtocolo, // undefined aqui = Baileys usa o padrao dele mesmo, sem quebrar nada
        auth: {
            creds: state.creds,
            // ✅ NOVO: wrapper recomendado oficialmente a partir do Baileys 7
            // pra cachear o acesso as chaves de sessao (Signal Protocol) em
            // memoria. Sem isso, leituras/escritas concorrentes no arquivo
            // de chaves podem se atropelar - um dos fatores que contribuem
            // pra sessao ficar inconsistente e gerar erros de "Bad MAC" /
            // "Failed to decrypt message with any known session".
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        logger: pino({ level: 'silent' }), // deixa o log do proprio Baileys quieto - usamos os nossos
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

// Descobre o JID de verdade pra um numero, perguntando ao proprio WhatsApp
// em vez de montar o endereco "no chute" a partir do numero digitado.
// Isso resolve o problema classico do "9" extra em numeros brasileiros:
// o Baileys as vezes aceita o envio pra um JID que nao existe de verdade
// (loga sucesso) mas a mensagem nunca chega. Consultando o onWhatsApp()
// primeiro, so seguimos com o JID que o WhatsApp confirmou que existe.
async function resolverJid(telefoneComDDI) {
    const resultado = await socketAtual.onWhatsApp(telefoneComDDI);

    if (!resultado || resultado.length === 0 || !resultado[0]?.exists) {
        throw new Error(
            `Numero ${telefoneComDDI} nao tem WhatsApp valido (onWhatsApp nao confirmou a existencia).`
        );
    }

    const jidRetornado = resultado[0].jid;

    // ✅ CORRIGIDO: o WhatsApp esta migrando pra um sistema de IDs internos
    // ocultos (@lid), separados do numero de telefone real (@s.whatsapp.net).
    // Quando onWhatsApp() devolve um JID @lid, o Baileys AINDA manda a
    // mensagem "com sucesso" (por isso o log de entregue) - so que pra um
    // endereco interno que nao e o mesmo da conversa visivel com aquele
    // contato. Por isso a mensagem nunca aparecia pro cliente, nem do
    // nosso lado (o item saia da fila como "entregue" e nunca mais era
    // reenviado).
    //
    // Agora so usamos o onWhatsApp() pra CONFIRMAR que o numero existe de
    // verdade (evita o bug classico do "9" extra em numeros brasileiros) -
    // mas se ele devolver um ID oculto (@lid), ignoramos e montamos o JID
    // tradicional a partir do proprio numero, que e o formato que
    // realmente abre a conversa visivel com o contato.
    if (jidRetornado.endsWith('@lid')) {
        const jidTradicional = `${telefoneComDDI}@s.whatsapp.net`;
        console.warn(
            `[WHATSAPP] onWhatsApp() devolveu ID oculto (@lid) para ${telefoneComDDI} - ` +
            `usando o JID tradicional em vez disso: ${jidTradicional}`
        );
        return jidTradicional;
    }

    console.log(`[WHATSAPP] JID resolvido para ${telefoneComDDI}: ${jidRetornado}`);
    return jidRetornado;
}

// Monta o texto final, acrescentando o Pix Copia e Cola (se configurado)
// pra quem só tem um celular e não consegue escanear o QR na tela do
// próprio aparelho - nesse caso, copia o texto e cola no app do banco.
function montarLegenda(textoOriginal) {
    if (!PIX_COPIA_COLA) return textoOriginal;
    return `${textoOriginal}\n\n📋 *Pix Copia e Cola* (toque e segure pra copiar):\n${PIX_COPIA_COLA}`;
}

// Funcao "crua" de envio - so e chamada pela fila (fila.js), nunca direto,
// pra garantir que sempre passa pelo throttle/retry.
async function enviarMensagemDireta(telefoneComDDI, texto) {
    if (!socketAtual || !conectado) {
        throw new Error('WhatsApp nao esta conectado no momento.');
    }

    const jid = await resolverJid(telefoneComDDI);
    const legenda = montarLegenda(texto);

    if (fs.existsSync(CAMINHO_QR_PIX)) {
        // Manda a imagem do QR Pix com a mensagem inteira como legenda -
        // fica muito mais profissional que só texto, e ainda cobre quem só
        // tem 1 celular (via o Copia e Cola dentro da legenda).
        await socketAtual.sendMessage(jid, {
            image: { url: CAMINHO_QR_PIX },
            caption: legenda,
        });
    } else {
        // Sem imagem cadastrada ainda - manda só o texto normalmente, sem
        // quebrar o envio.
        await socketAtual.sendMessage(jid, { text: legenda });
    }
}

// Ponto de entrada usado pelo resto do sistema (cron, rotas da API) -
// so adiciona na fila, nunca envia direto.
export function enviarMensagem(telefoneComDDI, texto) {
    fila.adicionar(telefoneComDDI, texto);
}

export function estaConectado() {
    return conectado;
}

export { iniciarConexao };
