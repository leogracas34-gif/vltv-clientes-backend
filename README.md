# VLTV Clientes - Bot de WhatsApp (backend)

Este backend faz UMA coisa: recebe um pedido do app Android ("manda essa mensagem pra esse
WhatsApp") e envia via um número de WhatsApp comum, usando Baileys (biblioteca não-oficial,
sem custo, sem precisar de aprovação da Meta).

Toda a lógica de cadastro de clientes, checagem de vencimento no Xtream e regras de quando
avisar fica dentro do **app Android** — este backend só executa o envio.

---

## 1. Instalar o Node.js na VPS (se ainda não tiver)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # confirme que apareceu uma versao 20.x
```

## 2. Subir este projeto pro GitHub e clonar na VPS

Suba esta pasta inteira num repositório novo no GitHub (ex: `vltv-clientes-backend`).
Depois, na VPS:

```bash
git clone https://github.com/SEU_USUARIO/vltv-clientes-backend.git
cd vltv-clientes-backend
npm install
```

## 3. Configurar o `.env`

```bash
cp .env.example .env
nano .env
```

Preencha:
- `API_KEY`: gere uma chave aleatória grande, por exemplo rodando `openssl rand -hex 32`
  (essa mesma chave vai dentro do app Android, no `BackendConfig.kt`)
- `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID`: os mesmos que seu site já usa hoje — servem só
  pra você receber o QR code do WhatsApp direto no Telegram, sem precisar olhar o terminal

Salve com `Ctrl+O`, `Enter`, `Ctrl+X`.

## 4. Expor com HTTPS via nginx (recomendado)

O app Android não consegue chamar `http://SEU_IP:3300` diretamente (Android bloqueia HTTP
puro por padrão). Como você já tem HTTPS configurado pra `vltvplay.tech`, crie um subdomínio
novo, do mesmo jeito que já existe `cdn.vltvplay.tech`:

```bash
sudo nano /etc/nginx/sites-available/clientes.vltvplay.tech
```

Cole (ajustando só a porta se você mudou `API_PORT` no `.env`):

```nginx
server {
    server_name clientes.vltvplay.tech;

    location / {
        proxy_pass http://localhost:3300;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    listen 80;
}
```

```bash
sudo ln -s /etc/nginx/sites-available/clientes.vltvplay.tech /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d clientes.vltvplay.tech
```

O certbot já ajusta o bloco pra `listen 443 ssl` automaticamente, igual fez com os outros
subdomínios seus.

## 5. Rodar o backend (teste manual primeiro)

```bash
npm start
```

Na primeira vez, um QR code chega **direto na sua conversa do Telegram** — abra o WhatsApp
que você quer usar como bot, vá em **Aparelhos conectados → Conectar um aparelho** e
escaneie esse QR.

Teste se está tudo certo:
```
https://clientes.vltvplay.tech/saude
```
Deve responder `{"ok":true,"whatsappConectado":true}`.

## 6. Deixar rodando permanentemente (PM2)

```bash
sudo npm install -g pm2
pm2 start src/server.js --name vltv-whatsapp
pm2 save
pm2 startup    # siga a instrução que ele imprimir (copiar/colar um comando)
```

Comandos do dia a dia:
```bash
pm2 logs vltv-whatsapp     # ver os logs em tempo real
pm2 restart vltv-whatsapp  # reiniciar depois de um git pull
```

---

## ⚠️ Migração pro Baileys 7 (ESM) — leia antes de fazer deploy dessa versão

Essa versão passou por duas mudanças importantes em relação à anterior:

1. **O projeto virou ESM** (`"type": "module"` no `package.json`, `import` em vez de
   `require` em todos os arquivos). Exige **Node 20 ou mais novo** — confirme com `node -v`
   antes de continuar.
2. **Baileys atualizado pra `7.0.0-rc14`** (pinado, sem `^`), pra corrigir os erros de
   `Bad MAC` / `Failed to decrypt message` e o problema do ID oculto (`@lid`) que
   apareciam constantemente na versão anterior (`6.7.9`/`6.7.22`).

**Importante: a migração de sessão do Baileys 7 não tem volta.** Assim que essa versão
abrir a pasta `auth_info_baileys/` pela primeira vez, ela reescreve o formato interno das
chaves — não dá mais pra voltar pra uma versão 6.x apontando pra essa mesma pasta depois
disso. O próprio código já faz um backup automático (`auth_info_baileys_backup_pre_v7/`)
na primeira vez que sobe, mas mesmo assim:

```bash
cd ~/vltv-clientes-backend
git pull
node -v                     # confirme 20.x ou mais novo
cp -r auth_info_baileys auth_info_baileys_backup_manual   # backup extra, por garantia
npm install                 # vai baixar o Baileys 7.0.0-rc14 novo
pm2 restart vltv-whatsapp
pm2 logs vltv-whatsapp
```

Como é a mesma sessão (mesmo `auth_info_baileys/`), **não precisa escanear QR code de
novo** — só reinicia. Se por acaso pedir QR (ex: sessão tinha caído antes do restart),
ele chega no Telegram normalmente.

**O que esperar de diferente nos logs:** os erros de `Bad MAC`/`Failed to decrypt` que
apareciam antes devem parar (ou ficar bem mais raros) — essa era exatamente a classe de
bug que o Baileys 7 corrigiu. Depois do restart, teste de novo com:

```bash
curl -X POST https://clientes.vltvplay.tech/enviar \
  -H "x-api-key: SUA_CHAVE_DO_ENV" \
  -H "Content-Type: application/json" \
  -d '{"telefone":"5531999998888","mensagem":"teste pos-migracao"}'
```

E confirma que a mensagem chega de verdade no aparelho (não só "entregue" no log).

---

## Endpoint da API

**`POST /enviar`** — exige o header `x-api-key: SUA_CHAVE_DO_ENV`

Body:
```json
{ "telefone": "5531999998888", "mensagem": "Seu plano vence em 2 dias..." }
```

Resposta imediata (a mensagem entra numa fila com espaçamento de 6-15s entre envios, com
retry automático em caso de falha):
```json
{ "ok": true, "mensagem": "Enfileirado para envio." }
```

**`GET /saude`** — sem autenticação, pra checagem simples de que o backend está de pé.

## Reconexão do WhatsApp

Se a sessão cair por instabilidade normal, o bot reconecta sozinho. Se for um logout de
verdade (você removeu o "aparelho conectado" pelo celular), o Telegram avisa e um novo QR
chega lá assim que você reiniciar o processo (`pm2 restart vltv-whatsapp`).
