import express from 'express';
import * as whatsapp from '../whatsapp/index.js';
import { buscarConteudo } from './tmdb.js';

const router = express.Router();

// POST /enviar
// Body: { "telefone": "5531999998888", "mensagem": "texto...", "imagem": "base64 opcional (JPEG)" }
// Enfileira o envio (a fila cuida do throttle/retry) e responde na hora,
// sem esperar a mensagem realmente sair - o app Android não precisa
// ficar esperando a fila processar pra continuar funcionando.
router.post('/enviar', (req, res) => {
    const { telefone, mensagem, imagem } = req.body;

    if (!telefone || !mensagem) {
        return res.status(400).json({ erro: 'Campos obrigatorios: telefone, mensagem.' });
    }

    const apenasDigitos = String(telefone).replace(/\D/g, '');
    if (apenasDigitos.length < 10) {
        return res.status(400).json({ erro: 'Telefone invalido. Use DDI+DDD+numero, so digitos (ex: 5531999998888).' });
    }

    // imagem, se vier, e uma string base64 (sem o prefixo "data:image/...")
    // de um JPEG - repassa como veio, quem decodifica e o whatsapp/index.js.
    whatsapp.enviarMensagem(apenasDigitos, mensagem, imagem || null);
    res.status(202).json({ ok: true, mensagem: 'Enfileirado para envio.' });
});

// GET /tmdb/buscar?q=nome+do+filme
// Usado pela tela de Gerador de Banner do app pra achar o pôster oficial
// de um filme/série. A chave do TMDB fica só no .env do servidor.
router.get('/tmdb/buscar', async (req, res) => {
    const termo = req.query.q;

    if (!termo || String(termo).trim().length < 2) {
        return res.status(400).json({ erro: 'Informe pelo menos 2 caracteres em "q".' });
    }

    try {
        const resultados = await buscarConteudo(String(termo).trim());
        res.json({ ok: true, resultados });
    } catch (erro) {
        console.error('[TMDB] Falha na busca:', erro.message);
        res.status(502).json({ erro: 'Falha ao buscar no TMDB: ' + erro.message });
    }
});

export default router;
