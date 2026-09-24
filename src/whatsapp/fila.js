const { enviarMensagemAdmin } = require('../telegram');

// Intervalo entre cada mensagem enviada (em ms). Mandar tudo de uma vez e o
// principal motivo de numeros nao-oficiais serem marcados como spam - por
// isso a fila processa UM item de cada vez, com um espaco aleatorio entre
// eles (fica mais "humano" do que um intervalo fixo).
const INTERVALO_MIN_MS = 6000;
const INTERVALO_MAX_MS = 15000;

const MAX_TENTATIVAS = 3;
const BACKOFF_BASE_MS = 10000; // 10s, 20s, 40s...

class FilaDeMensagens {
    constructor() {
        this.itens = [];
        this.processando = false;
        this.funcaoDeEnvio = null; // definida via setFuncaoDeEnvio()
    }

    // Injetado pelo whatsapp/index.js depois que a conexao com o Baileys
    // estiver pronta - evita dependencia circular entre os dois arquivos.
    setFuncaoDeEnvio(fn) {
        this.funcaoDeEnvio = fn;
    }

    // telefone: string so numeros, formato "5531999998888"
    // texto: mensagem a ser enviada
    adicionar(telefone, texto) {
        this.itens.push({ telefone, texto, tentativas: 0 });
        console.log(`[FILA] Mensagem adicionada para ${telefone}. Fila com ${this.itens.length} item(ns).`);
        this._processarProximo();
    }

    async _processarProximo() {
        if (this.processando) return; // ja tem um processamento em andamento
        if (this.itens.length === 0) return;
        if (!this.funcaoDeEnvio) {
            console.warn('[FILA] Nenhuma conexao WhatsApp disponivel ainda - aguardando.');
            return;
        }

        this.processando = true;
        const item = this.itens.shift();

        try {
            await this.funcaoDeEnvio(item.telefone, item.texto);
            console.log(`[FILA] Mensagem entregue com sucesso para ${item.telefone}.`);
        } catch (erro) {
            item.tentativas++;
            console.error(
                `[FILA] Falha ao enviar para ${item.telefone} (tentativa ${item.tentativas}/${MAX_TENTATIVAS}): ${erro.message}`
            );

            if (item.tentativas < MAX_TENTATIVAS) {
                const espera = BACKOFF_BASE_MS * Math.pow(2, item.tentativas - 1);
                setTimeout(() => {
                    this.itens.unshift(item); // volta pro INICIO da fila, pra tentar de novo antes dos outros
                    this._processarProximo();
                }, espera);
            } else {
                const msg =
                    `⚠️ Falha ao enviar mensagem de WhatsApp para ${item.telefone} ` +
                    `depois de ${MAX_TENTATIVAS} tentativas.\nMensagem: ${item.texto}`;
                enviarMensagemAdmin(msg);
            }
        } finally {
            this.processando = false;

            if (this.itens.length > 0) {
                const espera = INTERVALO_MIN_MS + Math.random() * (INTERVALO_MAX_MS - INTERVALO_MIN_MS);
                setTimeout(() => this._processarProximo(), espera);
            }
        }
    }
}

module.exports = new FilaDeMensagens();
