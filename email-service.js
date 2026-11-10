const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const EMAIL_CONFIG_FILE = path.join(DATA_DIR, 'email_config.json');
const DOMINIO_CONFIG_FILE = path.join(DATA_DIR, 'dominio_config.json');

function carregarConfigDominio() {
  try {
    if (fs.existsSync(DOMINIO_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(DOMINIO_CONFIG_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Erro ao ler dominio_config.json:', err);
  }
  return {
    dominio: 'venuseluar.com.br',
    url_base: 'https://venuseluar.com.br',
    nome_marca: 'Vênus e Luar Boutique',
    email_atendimento: 'atendimento@venuseluar.com.br',
    email_contato: 'contato@venuseluar.com.br',
    email_seguranca: 'seguranca@venuseluar.com.br',
    provedor_registro: 'Registro.br',
    provedor_email: 'google_workspace',
    ip_servidor: '185.199.108.153',
    ssl_ativo: true
  };
}

function salvarConfigDominio(novaConfig) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const atual = carregarConfigDominio();
    const configParaSalvar = { ...atual, ...novaConfig, atualizado_em: new Date().toISOString() };
    fs.writeFileSync(DOMINIO_CONFIG_FILE, JSON.stringify(configParaSalvar, null, 2), 'utf8');
    return { sucesso: true, config: configParaSalvar };
  } catch (err) {
    console.error('Erro ao salvar dominio_config.json:', err);
    return { sucesso: false, erro: err.message };
  }
}

function gerarRegistrosDns(config) {
  const c = config || carregarConfigDominio();
  const dom = c.dominio || 'venuseluar.com.br';
  const ip = c.ip_servidor || '185.199.108.153';
  const emailSeguranca = c.email_seguranca || `seguranca@${dom}`;

  return [
    {
      tipo: 'A',
      nome: '@ (raiz)',
      valor: ip,
      ttl: '3600 (1 hora)',
      descricao: 'Aponta o domínio raiz para o servidor web da boutique.',
      obrigatorio: true,
      status: 'Pronto para Apontamento'
    },
    {
      tipo: 'CNAME',
      nome: 'www',
      valor: dom,
      ttl: '3600 (1 hora)',
      descricao: 'Garante que o acesso com www redirecione com perfeição.',
      obrigatorio: true,
      status: 'Pronto para Apontamento'
    },
    {
      tipo: 'MX',
      nome: '@',
      valor: '10 smtp.google.com (ou mx.zoho.com / mail.titan.email)',
      ttl: '3600',
      descricao: 'Roteamento oficial dos e-mails corporativos recebidos (@' + dom + ').',
      obrigatorio: true,
      status: 'Recomendado'
    },
    {
      tipo: 'TXT',
      nome: '@ (SPF)',
      valor: 'v=spf1 include:_spf.google.com ~all',
      ttl: '3600',
      descricao: 'Sender Policy Framework: Autoriza o envio legítimo em nome de @' + dom + '.',
      obrigatorio: true,
      status: 'Anti-Spam Essencial'
    },
    {
      tipo: 'TXT',
      nome: '_dmarc',
      valor: `v=DMARC1; p=quarantine; rua=mailto:${emailSeguranca}; pct=100; adkim=r; aspf=r`,
      ttl: '3600',
      descricao: 'DMARC: Requisito de proteção global contra falsificação de identidade (spoofing).',
      obrigatorio: true,
      status: 'Obrigatório NIST/LGPD'
    },
    {
      tipo: 'TXT',
      nome: 'google._domainkey (DKIM)',
      valor: 'v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0vl9...',
      ttl: '3600',
      descricao: 'Assinatura digital criptográfica de integridade de e-mails emitidos pela boutique.',
      obrigatorio: true,
      status: 'Criptografia de Autoria'
    },
    {
      tipo: 'TXT',
      nome: '@ (Google Search Console)',
      valor: 'google-site-verification=74pQQ4qxkzU9A5hiqDkWvxR2nVy5CfbO_6UGfDNmUdg',
      ttl: '3600',
      descricao: 'Validação oficial de propriedade do domínio no Google Search Console e indexação Google.',
      obrigatorio: true,
      status: 'Indexação no Google'
    }
  ];
}

const PROVEDORES_PRESETS = {
  gmail: {
    nome: 'Gmail (Google)',
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    dica: 'Acesse https://myaccount.google.com/apppasswords com a Verificação em Duas Etapas ativa, crie uma senha para "Boutique" e cole os 16 caracteres aqui.'
  },
  outlook: {
    nome: 'Outlook / Hotmail / Microsoft 365',
    host: 'smtp-mail.outlook.com',
    port: 587,
    secure: false,
    dica: 'Utilize seu e-mail e senha da conta Microsoft (ou Senha de Aplicativo se possuir 2FA ativo).'
  },
  brevo: {
    nome: 'Brevo (Sendinblue)',
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    dica: 'Serviço gratuito com 300 e-mails reais diários. Obtenha sua chave SMTP em Brevo > SMTP & API.'
  },
  custom: {
    nome: 'SMTP Personalizado / Hospedagem (Hostinger, cPanel, Locaweb)',
    host: '',
    port: 465,
    secure: true,
    dica: 'Preencha com o host e porta fornecidos pelo seu provedor de hospedagem de e-mail.'
  }
};

function carregarConfigEmail() {
  try {
    if (fs.existsSync(EMAIL_CONFIG_FILE)) {
      const conteudo = fs.readFileSync(EMAIL_CONFIG_FILE, 'utf8');
      const dados = JSON.parse(conteudo);
      return {
        ativo: !!dados.ativo,
        provedor: dados.provedor || 'gmail',
        host: dados.host || 'smtp.gmail.com',
        port: Number(dados.port) || 465,
        secure: dados.secure !== false,
        user: dados.user || process.env.SMTP_USER || '',
        pass: dados.pass || process.env.SMTP_PASS || '',
        remetente: dados.remetente || 'Vênus e Luar Boutique'
      };
    }
  } catch (err) {
    console.error('Erro ao ler email_config.json:', err);
  }

  return {
    ativo: false,
    provedor: 'gmail',
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    remetente: 'Vênus e Luar Boutique'
  };
}

function salvarConfigEmail(novaConfig) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    
    let senhaFinal = (novaConfig.pass && !String(novaConfig.pass).includes('•')) ? novaConfig.pass : atual.pass;
    if (senhaFinal) senhaFinal = String(senhaFinal).replace(/\s+/g, '').trim();
    const configParaSalvar = {
      ...novaConfig,
      pass: senhaFinal
    };

    fs.writeFileSync(EMAIL_CONFIG_FILE, JSON.stringify(configParaSalvar, null, 2), 'utf8');
    console.log('💾 Configuração de e-mail salva com sucesso em data/email_config.json.');
    return { sucesso: true, config: configParaSalvar };
  } catch (err) {
    console.error('Erro ao salvar email_config.json:', err);
    return { sucesso: false, erro: err.message };
  }
}

function criarTransporter(config) {
  const salva = carregarConfigEmail();
  const conf = { ...(config || salva) };

  // Se a senha não foi informada ou veio como máscara (••••), usa a salva no banco
  if (!conf.pass || String(conf.pass).includes('•')) {
    conf.pass = salva.pass;
  }
  // Se o usuário não foi informado, usa o salvo
  if (!conf.user) {
    conf.user = salva.user;
  }

  if (!conf.user || !conf.pass) {
    return null;
  }

  // Limpa espaços na senha de aplicativo (o Google gera em blocos de 4 como "xxxx xxxx xxxx xxxx")
  const senhaLimpa = String(conf.pass).replace(/\s+/g, '').trim();

  return nodemailer.createTransport({
    host: conf.host || 'smtp.gmail.com',
    port: Number(conf.port) || 465,
    secure: conf.secure !== false,
    auth: {
      user: conf.user.trim(),
      pass: senhaLimpa
    },
    tls: {
      rejectUnauthorized: false
    }
  });
}

function gerarTemplateEmailRecuperacao({ nome, codigo, email }) {
  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="utf-8">
      <title>Recuperação de Acesso • Vênus e Luar Boutique</title>
      <style>
        body { margin: 0; padding: 0; background-color: #050811; font-family: 'Georgia', serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #f4efe6; }
        .wrapper { width: 100%; table-layout: fixed; background-color: #050811; padding: 40px 0; }
        .container { max-width: 600px; margin: 0 auto; background: #0c1222; border: 1px solid #c5a059; border-radius: 20px; overflow: hidden; box-shadow: 0 25px 60px rgba(0,0,0,0.8); }
        .header { padding: 45px 20px 25px; text-align: center; background: radial-gradient(circle at center, rgba(197, 160, 89, 0.2) 0%, rgba(12, 18, 34, 0.8) 75%); border-bottom: 1px solid rgba(197, 160, 89, 0.3); }
        .emblema { font-size: 38px; color: #c5a059; line-height: 1; margin-bottom: 10px; }
        .title { font-size: 26px; font-weight: bold; color: #d4af37; margin: 0; letter-spacing: 0.08em; text-transform: uppercase; }
        .subtitle { font-size: 11px; text-transform: uppercase; color: #dcd3c4; letter-spacing: 3px; margin-top: 8px; }
        .content { padding: 36px 40px; }
        .greeting { font-size: 17px; margin-bottom: 16px; color: #f4efe6; }
        .text { font-size: 14px; line-height: 1.7; color: #a8b3cf; margin-bottom: 24px; }
        .code-box { background: #070b14; border: 2px dashed #c5a059; border-radius: 16px; padding: 26px; text-align: center; margin: 28px 0; }
        .code-title { font-size: 11px; text-transform: uppercase; color: #c5a059; font-weight: bold; letter-spacing: 2px; margin-bottom: 10px; }
        .code { font-size: 40px; font-weight: bold; font-family: 'Courier New', Courier, monospace; letter-spacing: 10px; color: #ffffff; text-shadow: 0 0 20px rgba(197, 160, 89, 0.7); }
        .badge-timer { display: inline-block; margin-top: 12px; font-size: 12px; font-weight: bold; color: #fbbf24; background: rgba(251, 191, 36, 0.15); padding: 4px 12px; border-radius: 20px; border: 1px solid rgba(251, 191, 36, 0.3); }
        .info-card { background: rgba(197, 160, 89, 0.08); border-left: 3px solid #c5a059; padding: 14px 18px; border-radius: 0 10px 10px 0; margin-bottom: 24px; font-size: 13px; color: #cbd5e1; line-height: 1.5; }
        .footer { padding: 26px; text-align: center; border-top: 1px solid rgba(197, 160, 89, 0.2); font-size: 11px; color: #64748b; background: #070a12; line-height: 1.6; }
      </style>
    </head>
    <body>
      <div class="wrapper">
        <div class="container">
          <div class="header">
            <div class="emblema">✦</div>
            <h1 class="title">Vênus &amp; Luar</h1>
            <div class="subtitle">Haute Couture • Exclusividade &amp; Segurança</div>
          </div>
          <div class="content">
            <div class="greeting">Estimada(o) <strong>${nome || 'Cliente'}</strong>,</div>
            <p class="text">
              Recebemos uma solicitação oficial para a redefinição de senha da sua conta exclusiva na <strong>Vênus e Luar Boutique</strong>.
              Para prosseguir com a alteração com total proteção, utilize o código de uso único abaixo:
            </p>
            <div class="code-box">
              <div class="code-title">Código de Autorização Exclusivo</div>
              <div class="code">${codigo}</div>
              <div class="badge-timer">⏱️ Válido por 15 minutos • Uso único</div>
            </div>
            <div class="info-card">
              🛡️ <strong>Segurança NIST &amp; LGPD:</strong> Nunca compartilhe este código com terceiros. A equipe da boutique nunca solicitará este código por telefone ou redes sociais.
            </div>
            <p class="text">
              Se você não solicitou a redefinição de acesso, por favor desconsidere este e-mail. Seus dados e credenciais permanecem protegidos sob criptografia de alta resistência SCrypt.
            </p>
          </div>
          <div class="footer">
            <strong>Vênus e Luar Boutique</strong> — Alta Costura, Espaço Pet Nobre &amp; Cafeteria Bistrô.<br>
            Ambiente protegido com criptografia SCrypt e conformidade com a LGPD.<br>
            Este é um e-mail automático gerado pelo sistema de segurança da boutique.
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

async function enviarEmailRecuperacaoReal({ para, nome, codigo }) {
  const config = carregarConfigEmail();
  const transporter = criarTransporter(config);

  if (!transporter) {
    console.log(`ℹ️ [EMAIL] Credenciais SMTP não preenchidas. O código [${codigo}] foi gerado para o cliente ${para}. Configure em data/email_config.json ou no painel admin para envio direto.`);
    return {
      enviado: false,
      configurado: false,
      motivo: 'Credenciais de e-mail SMTP ainda não preenchidas no sistema.'
    };
  }

  const html = gerarTemplateEmailRecuperacao({ nome, codigo, email: para });

  try {
    const info = await transporter.sendMail({
      from: `"${config.remetente || 'Vênus e Luar Boutique'}" <${config.user}>`,
      to: para,
      subject: `🌙 [Vênus e Luar] Código de Recuperação de Senha: ${codigo}`,
      text: `Olá ${nome}! Seu código exclusivo para redefinir sua senha na Vênus e Luar Boutique é: ${codigo}. Este código é válido por 15 minutos.`,
      html
    });

    console.log(`📧 [EMAIL REAL ENVIADO COM SUCESSO]`);
    console.log(`👤 Destinatário: ${para}`);
    console.log(`🆔 MessageId: ${info.messageId}`);
    return {
      enviado: true,
      configurado: true,
      messageId: info.messageId
    };
  } catch (err) {
    console.error(`❌ [FALHA AO ENVIAR EMAIL REAL] Para: ${para} | Erro:`, err.message);
    return {
      enviado: false,
      configurado: true,
      erro: err.message
    };
  }
}

async function enviarEmailTesteReal({ para, configTeste }) {
  const salva = carregarConfigEmail();
  const config = { ...(configTeste || salva) };
  if (!config.pass || String(config.pass).includes('•')) {
    config.pass = salva.pass;
  }
  if (!config.user) {
    config.user = salva.user;
  }
  if (!config.remetente) {
    config.remetente = salva.remetente || 'Vênus e Luar Boutique';
  }
  const transporter = criarTransporter(config);

  if (!transporter) {
    return {
      sucesso: false,
      erro: 'Preencha o e-mail de envio e a senha de aplicativo para realizar o teste.'
    };
  }

  const html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head><meta charset="utf-8"></head>
    <body style="background:#070b14; color:#f4efe6; font-family:'Georgia',serif; padding:30px;">
      <div style="max-width:550px; margin:0 auto; background:#0c1222; border:1px solid #c5a059; border-radius:16px; padding:30px; text-align:center;">
        <div style="font-size:32px; color:#c5a059;">✦</div>
        <h2 style="color:#d4af37; margin:10px 0 4px; text-transform:uppercase;">Vênus &amp; Luar Boutique</h2>
        <p style="color:#94a3b8; font-size:12px; letter-spacing:2px; text-transform:uppercase; margin-bottom:20px;">Teste de Conexão SMTP Real</p>
        <div style="background:#070b14; border:1px solid rgba(197,160,89,0.4); border-radius:12px; padding:20px; margin:20px 0; color:#34d399; font-weight:bold;">
          ✓ E-mail real entregue com sucesso!
        </div>
        <p style="font-size:13px; color:#cbd5e1; line-height:1.6;">
          Este e-mail comprova que o servidor da boutique está conectado com sucesso ao seu provedor SMTP (<strong>${config.provedor || 'SMTP'}</strong>) e pronto para enviar mensagens reais aos seus clientes.
        </p>
        <div style="font-size:11px; color:#64748b; margin-top:20px; border-top:1px solid rgba(197,160,89,0.2); padding-top:15px;">
          Enviado em ${new Date().toLocaleString('pt-BR')} via Vênus e Luar Boutique.
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"${config.remetente || 'Vênus e Luar Boutique'}" <${config.user}>`,
      to: para,
      subject: `🌙 [Vênus e Luar] Teste de Conexão SMTP Bem-Sucedido!`,
      text: `Parabéns! O teste de disparo de e-mail real da Vênus e Luar Boutique foi executado com sucesso para ${para}.`,
      html
    });

    console.log(`✅ [TESTE SMTP REAL SUCESSO] Destino: ${para} | MessageId: ${info.messageId}`);
    return { sucesso: true, messageId: info.messageId };
  } catch (err) {
    console.error(`❌ [TESTE SMTP FALHA]:`, err.message);
    return { sucesso: false, erro: err.message };
  }
}

module.exports = {
  PROVEDORES_PRESETS,
  carregarConfigEmail,
  salvarConfigEmail,
  enviarEmailRecuperacaoReal,
  enviarEmailTesteReal,
  carregarConfigDominio,
  salvarConfigDominio,
  gerarRegistrosDns
};
