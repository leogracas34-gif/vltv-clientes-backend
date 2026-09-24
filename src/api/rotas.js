const express = require('express');
const router = express.Router();

const whatsapp = require('../whatsapp');

// POST /enviar
// Body: { "telefone": "5531999998888", "mensagem": "texto..." }
// Enfileira o envio (a fila cuida do throttle/retry) e responde na hora,
// sem esperar a mensagem realmente sair - o app Android não precisa
// ficar esperando a fila processar pra continuar funcionando.
router.post('/enviar', (req, res) => {
    const { telefone, mensagem } = req.body;

    if (!telefone || !mensagem) {
        return res.status(400).json({ erro: 'Campos obrigatorios: telefone, mensagem.' });
    }

    const apenasDigitos = String(telefone).replace(/\D/g, '');
    if (apenasDigitos.length < 10) {
        return res.status(400).json({ erro: 'Telefone invalido. Use DDI+DDD+numero, so digitos (ex: 5531999998888).' });
    }

    whatsapp.enviarMensagem(apenasDigitos, mensagem);
    res.status(202).json({ ok: true, mensagem: 'Enfileirado para envio.' });
});

module.exports = router;
