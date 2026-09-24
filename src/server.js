require('dotenv').config();

const express = require('express');

const { autenticar } = require('./api/autenticacao');
const rotas = require('./api/rotas');
const whatsapp = require('./whatsapp');
const { enviarMensagemAdmin } = require('./telegram');

async function iniciar() {
    console.log('=== VLTV Clientes - Bot de WhatsApp ===');

    // Conecta em segundo plano; o QR (se precisar) chega pelo Telegram.
    whatsapp.iniciarConexao().catch((erro) => {
        console.error('[WHATSAPP] Falha ao iniciar conexao:', erro.message);
    });

    const app = express();
    app.use(express.json());

    app.get('/saude', (req, res) => {
        res.json({ ok: true, whatsappConectado: whatsapp.estaConectado() });
    });

    app.use(autenticar); // tudo abaixo exige "x-api-key" valido
    app.use(rotas);

    const porta = process.env.API_PORT || 3300;
    app.listen(porta, () => {
        console.log(`[API] Servidor rodando na porta ${porta}.`);
    });

    await enviarMensagemAdmin('🚀 Bot de WhatsApp do VLTV Clientes iniciado.');
}

iniciar().catch((erro) => {
    console.error('[FATAL] Erro ao iniciar o backend:', erro);
    process.exit(1);
});
