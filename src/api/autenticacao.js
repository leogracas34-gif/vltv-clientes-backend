// Autenticacao simples por chave fixa, enviada pelo app Android no header
// "x-api-key". E suficiente pro caso de uso (um unico app cliente, admin
// unico) sem precisar de login/senha/JWT.
function autenticar(req, res, next) {
    const chaveEnviada = req.header('x-api-key');
    const chaveEsperada = process.env.API_KEY;

    if (!chaveEsperada) {
        console.error('[API] API_KEY nao configurada no .env - recusando todas as requisicoes.');
        return res.status(500).json({ erro: 'Servidor mal configurado (API_KEY ausente).' });
    }

    if (chaveEnviada !== chaveEsperada) {
        return res.status(401).json({ erro: 'Chave de API invalida.' });
    }

    next();
}

module.exports = { autenticar };
