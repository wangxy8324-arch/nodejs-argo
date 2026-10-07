#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const crypto = require('crypto');
const { exec, execSync } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

// ==================== 环境变量 ====================

const UPLOAD_URL = process.env.UPLOAD_URL || '';
const PROJECT_URL = process.env.PROJECT_URL || '';
const AUTO_ACCESS = process.env.AUTO_ACCESS || '';
const FILE_PATH = process.env.FILE_PATH || './';
const SUB_PATH = process.env.SUB_PATH || 'sub';
const PORT = process.env.PORT || 3000;

const UUID = process.env.UUID || crypto.randomUUID();

const NEZHA_SERVER = process.env.NEZHA_SERVER || '';
const NEZHA_PORT = process.env.NEZHA_PORT || '';
const NEZHA_KEY = process.env.NEZHA_KEY || '';

const ARGO_DOMAIN = process.env.ARGO_DOMAIN || '';
const ARGO_AUTH = process.env.ARGO_AUTH || '';
const ARGO_PORT = process.env.ARGO_PORT || 8001;

const S5_PORT = process.env.S5_PORT || '';
const HY2_PORT = process.env.HY2_PORT || '';
const REALITY_PORT = process.env.REALITY_PORT || '';

const CFIP = process.env.CFIP || '';
const CFPORT = process.env.CFPORT || 443;

const NAME = process.env.NAME || '';
const CHAT_ID = process.env.CHAT_ID || '';
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const SHOW_LOG = process.env.SHOW_LOG || 'false';

// ==================== 文件路径 ====================

const webName = 'web';
const botName = 'bot';

const webPath = path.join(FILE_PATH, webName);
const botPath = path.join(FILE_PATH, botName);

const npmPath = path.join(FILE_PATH, 'npm');
const phpPath = path.join(FILE_PATH, 'php');

const configPath = path.join(FILE_PATH, 'config.json');
const certPath = path.join(FILE_PATH, 'cert.pem');
const keyPath = path.join(FILE_PATH, 'key.pem');

const subPath = path.join(FILE_PATH, SUB_PATH);

const bootLogPath = path.join(FILE_PATH, 'boot.log');

// ==================== 基础函数 ====================

function isValidPort(port) {
  const p = parseInt(port);
  return Number.isInteger(p) && p > 0 && p <= 65535;
}

function randomString(length = 8) {
  const chars =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  let result = '';

  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return result;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getArchitecture() {
  const arch = os.arch();

  if (arch === 'arm64' || arch === 'aarch64') {
    return 'arm';
  }

  return 'amd64';
}

// ==================== 生成 Reality 密钥 ====================

function generateRealityKeyPair() {
  try {
    const result = execSync(
      `${webPath} x25519`,
      {
        encoding: 'utf8',
        timeout: 10000
      }
    );

    const lines = result
      .split('\n')
      .map(x => x.trim())
      .filter(Boolean);

    let privateKey = '';
    let publicKey = '';

    for (const line of lines) {
      if (/PrivateKey/i.test(line)) {
        privateKey = line.split(':').slice(1).join(':').trim();
      }

      if (/Password/i.test(line) && !publicKey) {
        publicKey = line.split(':').slice(1).join(':').trim();
      }

      if (/PublicKey/i.test(line)) {
        publicKey = line.split(':').slice(1).join(':').trim();
      }
    }

    return {
      privateKey,
      publicKey
    };
  } catch (error) {
    return {
      privateKey: '',
      publicKey: ''
    };
  }
}

let privateKey = '';
let publicKey = '';

function initRealityKeys() {
  if (!isValidPort(REALITY_PORT)) {
    return;
  }

  const keys = generateRealityKeyPair();

  privateKey = keys.privateKey;
  publicKey = keys.publicKey;

  if (!privateKey) {
    try {
      const result = execSync(
        `${webPath} x25519`,
        {
          encoding: 'utf8'
        }
      );

      const matchPrivate = result.match(
        /PrivateKey:\s*([A-Za-z0-9+/=_-]+)/
      );

      const matchPublic = result.match(
        /PublicKey:\s*([A-Za-z0-9+/=_-]+)/
      );

      if (matchPrivate) {
        privateKey = matchPrivate[1];
      }

      if (matchPublic) {
        publicKey = matchPublic[1];
      }
    } catch (error) {
      console.log('Reality key generation failed');
    }
  }
}

// ==================== 下载文件 ====================

async function downloadFile(url, destination) {
  try {
    const response = await axios({
      method: 'GET',
      url,
      responseType: 'arraybuffer',
      timeout: 30000
    });

    fs.writeFileSync(destination, response.data);

    try {
      fs.chmodSync(destination, 0o755);
    } catch (error) {
      // Windows ignore
    }

    return true;
  } catch (error) {
    console.error(`Download failed: ${url}`);
    return false;
  }
}

// ==================== 获取服务器信息 ====================

async function getMetaInfo() {
  try {
    const response = await axios.get(
      'https://ipinfo.io/json',
      {
        timeout: 5000
      }
    );

    if (
      response.data &&
      response.data.country &&
      response.data.org
    ) {
      return `${response.data.country}-${response.data.org}`
        .replace(/\s+/g, '_');
    }
  } catch (error) {
    // ignore
  }

  try {
    const response2 = await axios.get(
      'http://ip-api.com/json',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0'
        },
        timeout: 5000
      }
    );

    if (
      response2.data &&
      response2.data.status === 'success' &&
      response2.data.countryCode &&
      response2.data.org
    ) {
      return `${response2.data.countryCode}-${response2.data.org}`
        .replace(/\s+/g, '_');
    }
  } catch (error) {
    // ignore
  }

  return 'Unknown';
}

// ==================== 获取服务器公网IP ====================

async function getServerIP() {
  let serverIP = '';

  try {
    const ipv4Response = await axios.get(
      'http://ipv4.ip.sb',
      {
        timeout: 3000
      }
    );

    serverIP = ipv4Response.data.trim();
  } catch (err) {
    try {
      serverIP = execSync(
        'curl -sm 3 ipv4.ip.sb'
      )
        .toString()
        .trim();
    } catch (curlErr) {
      try {
        const ipv6Response = await axios.get(
          'http://ipv6.ip.sb',
          {
            timeout: 3000
          }
        );

        serverIP = `[${ipv6Response.data.trim()}]`;
      } catch (ipv6AxiosErr) {
        try {
          serverIP = `[${execSync(
            'curl -sm 3 ipv6.ip.sb'
          )
            .toString()
            .trim()}]`;
        } catch (ipv6CurlErr) {
          console.error(
            'Failed to get IP address:',
            ipv6CurlErr.message
          );
        }
      }
    }
  }

  return serverIP;
}

// ==================== 生成 Xray 配置 ====================

async function generateConfig() {
  const config = {
    log: {
      access: '/dev/null',
      error: '/dev/null',
      loglevel: 'none'
    },

    inbounds: [

      // =====================================================
      // 核心节点：
      // Cloudflare Tunnel
      //        ↓
      // 127.0.0.1:8001
      //        ↓
      // VLESS + XHTTP
      // =====================================================

      {
        tag: 'vless-xhttp-in',

        port: parseInt(ARGO_PORT),

        listen: '127.0.0.1',

        protocol: 'vless',

        settings: {
          clients: [
            {
              id: UUID,
              level: 0
            }
          ],

          decryption: 'none'
        },

        streamSettings: {
          network: 'xhttp',

          security: 'none',

          xhttpSettings: {
            path: '/vless-argo',

            // 对 CDN / Cloudflare / 反代兼容性优先
            mode: 'packet-up'
          }
        },

        sniffing: {
          enabled: true,

          destOverride: [
            'http',
            'tls',
            'quic'
          ],

          metadataOnly: false
        }
      },

      // =====================================================
      // VLESS TCP
      // =====================================================

      {
        tag: 'vless-tcp-in',

        port: 3001,

        listen: '127.0.0.1',

        protocol: 'vless',

        settings: {
          clients: [
            {
              id: UUID
            }
          ],

          decryption: 'none'
        },

        streamSettings: {
          network: 'tcp',

          security: 'none'
        }
      }
    ],

    dns: {
      servers: [
        'https+local://8.8.8.8/dns-query'
      ]
    },

    outbounds: [
      {
        protocol: 'freedom',

        tag: 'direct'
      },

      {
        protocol: 'blackhole',

        tag: 'block'
      }
    ]
  };

  // =====================================================
  // VLESS Reality
  // =====================================================

  if (isValidPort(REALITY_PORT)) {

    config.inbounds.push({

      tag: 'vless-in',

      listen: '::',

      port: parseInt(REALITY_PORT),

      protocol: 'vless',

      settings: {

        clients: [
          {
            id: UUID,

            flow: 'xtls-rprx-vision'
          }
        ],

        decryption: 'none'
      },

      streamSettings: {

        network: 'raw',

        security: 'reality',

        realitySettings: {

          show: false,

          dest: 'www.iij.ad.jp:443',

          xver: 0,

          serverNames: [
            'www.iij.ad.jp'
          ],

          privateKey: privateKey,

          shortIds: [
            ''
          ]
        }
      }
    });
  }

  // =====================================================
  // Hysteria2
  // =====================================================

  if (isValidPort(HY2_PORT)) {

    config.inbounds.push({

      tag: 'hysteria2-in',

      listen: '::',

      port: parseInt(HY2_PORT),

      protocol: 'hysteria',

      settings: {

        version: 2,

        users: {
          [UUID]: 'x'
        }
      },

      streamSettings: {

        network: 'hysteria',

        security: 'tls',

        tlsSettings: {

          alpn: [
            'h3'
          ],

          certificates: [
            {
              certificateFile: certPath,

              keyFile: keyPath
            }
          ]
        }
      }
    });
  }

  // =====================================================
  // SOCKS5
  // =====================================================

  if (isValidPort(S5_PORT)) {

    config.inbounds.push({

      tag: 'socks5-in',

      listen: '::',

      port: parseInt(S5_PORT),

      protocol: 'socks',

      settings: {

        auth: 'noauth',

        udp: true
      }
    });
  }

  fs.writeFileSync(
    configPath,

    JSON.stringify(
      config,
      null,
      2
    )
  );

  return config;
}

// ==================== 生成证书 ====================

function generateCertificate() {

  if (
    !isValidPort(HY2_PORT) ||
    fs.existsSync(certPath) &&
    fs.existsSync(keyPath)
  ) {
    return;
  }

  try {

    execSync(
      `openssl req -x509 -newkey rsa:2048 -nodes -keyout "${keyPath}" -out "${certPath}" -days 3650 -subj "/CN=www.bing.com"`,
      {
        stdio: 'ignore'
      }
    );

  } catch (error) {

    console.log(
      'Certificate generation failed'
    );
  }
}

// ==================== 获取证书指纹 ====================

function getCertificateFingerprint(file) {

  try {

    const output = execSync(
      `openssl x509 -in "${file}" -noout -fingerprint -sha256`,
      {
        encoding: 'utf8'
      }
    );

    const match = output.match(
      /=([A-F0-9:]+)/
    );

    if (!match) {
      return '';
    }

    return match[1].replace(
      /:/g,
      ''
    );

  } catch (error) {

    return '';
  }
}

// ==================== 生成订阅 ====================

async function generateLinks(argoDomain) {

  const ISP = await getMetaInfo();

  const nodeName =
    NAME
      ? `${NAME}-${ISP}`
      : ISP;

  const SERVER_IP =
    await getServerIP();

  return new Promise(resolve => {

    setTimeout(() => {

      // ===================================================
      // 唯一主节点：
      // VLESS + XHTTP
      // ===================================================

      let subTxt = `

vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${argoDomain}&fp=firefox&type=xhttp&host=${argoDomain}&path=%2Fvless-argo&mode=packet-up#${nodeName}

`;

      // ===================================================
      // Hysteria2
      // ===================================================

      if (isValidPort(HY2_PORT)) {

        const fingerprint =
          getCertificateFingerprint(
            certPath
          );

        const fingerprintParam =
          fingerprint
            ? `&pinSHA256=${encodeURIComponent(
                fingerprint
              )}`
            : '';

        const hysteriaNode =
          `hysteria2://${UUID}@${SERVER_IP}:${HY2_PORT}/?sni=www.bing.com&insecure=0&alpn=h3&obfs=none${fingerprintParam}#${nodeName}`;

        subTxt +=
          `\n${hysteriaNode}\n`;
      }

      // ===================================================
      // Reality
      // ===================================================

      if (
        isValidPort(REALITY_PORT) &&
        publicKey
      ) {

        const realityNode =
          `vless://${UUID}@${SERVER_IP}:${REALITY_PORT}?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.iij.ad.jp&fp=chrome&pbk=${publicKey}&sid=&type=tcp#${nodeName}-Reality`;

        subTxt +=
          `\n${realityNode}\n`;
      }

      // ===================================================
      // SOCKS5
      // ===================================================

      if (isValidPort(S5_PORT)) {

        const socksNode =
          `socks://${SERVER_IP}:${S5_PORT}#${nodeName}-Socks5`;

        subTxt +=
          `\n${socksNode}\n`;
      }

      subTxt =
        subTxt.trim() +
        '\n';

      fs.mkdirSync(
        subPath,
        {
          recursive: true
        }
      );

      const base64Sub =
        Buffer.from(
          subTxt
        ).toString('base64');

      fs.writeFileSync(
        path.join(
          subPath,
          'sub.txt'
        ),
        subTxt
      );

      fs.writeFileSync(
        path.join(
          subPath,
          'sub_base64.txt'
        ),
        base64Sub
      );

      console.log(
        '\n========== XHTTP SUBSCRIPTION ==========\n'
      );

      console.log(subTxt);

      console.log(
        '========================================\n'
      );

      resolve(subTxt);

    }, 1000);
  });
}

// ==================== 上传订阅 ====================

async function uploadSubscription(content) {

  if (!UPLOAD_URL) {
    return;
  }

  try {

    await axios.post(
      UPLOAD_URL,
      {
        content
      },
      {
        timeout: 15000
      }
    );

    console.log(
      'Subscription uploaded successfully'
    );

  } catch (error) {

    console.log(
      'Subscription upload failed'
    );
  }
}

// ==================== Telegram ====================

async function sendTelegram(message) {

  if (
    !BOT_TOKEN ||
    !CHAT_ID
  ) {
    return;
  }

  try {

    await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        chat_id: CHAT_ID,

        text: message,

        disable_web_page_preview: true
      },
      {
        timeout: 10000
      }
    );

  } catch (error) {

    console.log(
      'Telegram notification failed'
    );
  }
}

// ==================== Nezha ====================

async function runNezha() {

  if (
    !NEZHA_SERVER ||
    !NEZHA_KEY
  ) {

    console.log(
      'NEZHA variable is empty,skip running'
    );

    return;
  }

  try {

    if (NEZHA_PORT) {

      const command =
        `nohup ${npmPath} -s ${NEZHA_SERVER}:${NEZHA_PORT} -p ${NEZHA_KEY} >/dev/null 2>&1 &`;

      await exec(command);

    } else {

      const command =
        `nohup ${phpPath} -s ${NEZHA_SERVER} -p ${NEZHA_KEY} >/dev/null 2>&1 &`;

      await exec(command);
    }

    console.log(
      'Nezha is running'
    );

  } catch (error) {

    console.error(
      `npm running error: ${error}`
    );
  }
}

// ==================== 运行 Xray / Cloudflare ====================

async function runServices() {

  // =====================================================
  // 运行 Xray
  // =====================================================

  const command1 =
    `nohup ${webPath} -c ${FILE_PATH}/config.json >/dev/null 2>&1 &`;

  try {

    await exec(command1);

    console.log(
      `${webName} is running`
    );

    await sleep(1000);

  } catch (error) {

    console.error(
      `web running error: ${error}`
    );
  }

  // =====================================================
  // 运行 Cloudflare Tunnel
  // =====================================================

  if (fs.existsSync(botPath)) {

    let args;

    // Token 模式
    if (
      ARGO_AUTH.match(
        /^[A-Z0-9a-z=]{120,250}$/
      )
    ) {

      args =
        `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 run --token ${ARGO_AUTH}`;

    }

    // TunnelSecret 模式
    else if (
      ARGO_AUTH.match(
        /TunnelSecret/
      )
    ) {

      args =
        `tunnel --edge-ip-version auto --config "${path.resolve(FILE_PATH, 'tunnel.yml')}" run`;

    }

    // Quick Tunnel
    else {

      args =
        `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile "${path.resolve(bootLogPath)}" --loglevel info --url http://127.0.0.1:${ARGO_PORT}`;

    }

    try {

      await exec(
        `nohup "${path.resolve(botPath)}" ${args} >/dev/null 2>&1 &`
      );

      console.log(
        `${botName} is running`
      );

      await sleep(2000);

    } catch (error) {

      console.error(
        `Error executing command: ${error}`
      );
    }
  }

  await sleep(5000);
}

// ==================== 根据架构获取文件 ====================

function getFilesForArchitecture(
  architecture
) {

  const baseUrl =
    architecture === 'arm'
      ? 'https://arm64.oooen.com'
      : 'https://amd64.oooen.com';

  const backupUrl =
    architecture === 'arm'
      ? 'https://arm64.ssss.nyc.mn'
      : 'https://amd64.ssss.nyc.mn';

  const baseFiles = [

    {
      fileName: webPath,

      fileUrls: [
        `${baseUrl}/web`,
        `${backupUrl}/web`
      ]
    },

    {
      fileName: botPath,

      fileUrls: [
        `${baseUrl}/bot`,
        `${backupUrl}/bot`
      ]
    }

  ];

  if (
    NEZHA_SERVER &&
    NEZHA_KEY
  ) {

    if (NEZHA_PORT) {

      baseFiles.unshift({

        fileName: npmPath,

        fileUrls: [
          `${baseUrl}/agent`,
          `${backupUrl}/agent`
        ]
      });

    } else {

      baseFiles.unshift({

        fileName: phpPath,

        fileUrls: [
          `${baseUrl}/v1`,
          `${backupUrl}/v1`
        ]
      });
    }
  }

  return baseFiles;
}

// ==================== 固定 Tunnel ====================

function argoType() {

  if (
    !ARGO_AUTH ||
    !ARGO_DOMAIN
  ) {

    console.log(
      'ARGO_DOMAIN or ARGO_AUTH is empty, use quick tunnels'
    );

    return;
  }

  if (
    ARGO_AUTH.includes(
      'TunnelSecret'
    )
  ) {

    fs.writeFileSync(
      path.join(
        FILE_PATH,
        'tunnel.json'
      ),
      ARGO_AUTH
    );

    const tunnelYaml = `

  tunnel: ${ARGO_AUTH.split('"')[11]}

  credentials-file: ${path.join(
    FILE_PATH,
    'tunnel.json'
  )}

  protocol: http2

  ingress:

    - hostname: ${ARGO_DOMAIN}

      service: http://127.0.0.1:${ARGO_PORT}

      originRequest:

        noTLSVerify: true

    - service: http_status:404

  `;

    fs.writeFileSync(
      path.join(
        FILE_PATH,
        'tunnel.yml'
      ),
      tunnelYaml
    );

  } else {

    console.log(
      `Using token connect to tunnel, please set ${ARGO_PORT} in clouudflare`
    );
  }
}

// ==================== 获取 Quick Tunnel 日志 ====================

async function waitForQuickTunnelLog(
  timeoutMs = 30000
) {

  const deadline =
    Date.now() + timeoutMs;

  while (
    Date.now() < deadline
  ) {

    try {

      if (
        fs.existsSync(
          bootLogPath
        )
      ) {

        const content =
          fs.readFileSync(
            bootLogPath,
            'utf-8'
          );

        if (
          /trycloudflare\.com/.test(
            content
          )
        ) {

          return content;
        }
      }

    } catch (error) {

      // 日志文件可能仍在创建
    }

    await sleep(1000);
  }

  return '';
}

// ==================== 获取临时 Tunnel Domain ====================

async function extractDomains() {

  let argoDomain;

  // 固定域名
  if (
    ARGO_AUTH &&
    ARGO_DOMAIN
  ) {

    argoDomain =
      ARGO_DOMAIN;

    console.log(
      'ARGO_DOMAIN:',
      argoDomain
    );

    await generateLinks(
      argoDomain
    );

    return;
  }

  // Quick Tunnel
  try {

    const fileContent =
      await waitForQuickTunnelLog();

    const lines =
      fileContent.split('\n');

    const argoDomains = [];

    lines.forEach(line => {

      const domainMatch =
        line.match(
          /https?:\/\/([^ ]*trycloudflare\.com)\/?/
        );

      if (domainMatch) {

        const domain =
          domainMatch[1];

        argoDomains.push(
          domain
        );
      }
    });

    if (
      argoDomains.length > 0
    ) {

      argoDomain =
        argoDomains[0];

      console.log(
        'ArgoDomain:',
        argoDomain
      );

      await generateLinks(
        argoDomain
      );

    } else {

      console.log(
        'ArgoDomain not found, re-running bot to obtain ArgoDomain'
      );

      try {

        fs.unlinkSync(
          path.join(
            FILE_PATH,
            'boot.log'
          )
        );

      } catch (error) {
        // ignore
      }

      async function killBotProcess() {

        try {

          if (
            process.platform === 'win32'
          ) {

            await exec(
              `taskkill /f /im ${botName}.exe > nul 2>&1`
            );

          } else {

            await exec(
              `pkill -f "[${botName.charAt(0)}]${botName.substring(1)}" > /dev/null 2>&1`
            );
          }

        } catch (error) {
          // ignore
        }
      }

      await killBotProcess();

      await sleep(3000);

      const args =
        `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile "${path.resolve(bootLogPath)}" --loglevel info --url http://127.0.0.1:${ARGO_PORT}`;

      try {

        await exec(
          `nohup "${path.resolve(botPath)}" ${args} >/dev/null 2>&1 &`
        );

      } catch (error) {

        console.error(
          'Failed to restart cloudflared'
        );
      }

      const retryContent =
        await waitForQuickTunnelLog(
          30000
        );

      const retryLines =
        retryContent.split('\n');

      for (
        const line of retryLines
      ) {

        const match =
          line.match(
            /https?:\/\/([^ ]*trycloudflare\.com)\/?/
          );

        if (match) {

          argoDomain =
            match[1];

          break;
        }
      }

      if (argoDomain) {

        console.log(
          'Retry ArgoDomain:',
          argoDomain
        );

        await generateLinks(
          argoDomain
        );
      }
    }

  } catch (error) {

    console.error(
      'extractDomains error:',
      error.message
    );
  }
}

// ==================== HTTP 订阅服务器 ====================

function startSubscriptionServer() {

  const http =
    require('http');

  const server =
    http.createServer(
      (req, res) => {

        try {

          const url =
            new URL(
              req.url,
              `http://${req.headers.host}`
            );

          // Base64 订阅
          if (
            url.pathname ===
            `/${SUB_PATH}`
          ) {

            const file =
              path.join(
                subPath,
                'sub_base64.txt'
              );

            if (
              fs.existsSync(file)
            ) {

              const content =
                fs.readFileSync(
                  file,
                  'utf8'
                );

              res.writeHead(
                200,
                {
                  'Content-Type':
                    'text/plain; charset=utf-8',

                  'Cache-Control':
                    'no-cache'
                }
              );

              res.end(
                content
              );

              return;
            }
          }

          // 原始订阅
          if (
            url.pathname ===
            `/${SUB_PATH}/raw`
          ) {

            const file =
              path.join(
                subPath,
                'sub.txt'
              );

            if (
              fs.existsSync(file)
            ) {

              const content =
                fs.readFileSync(
                  file,
                  'utf8'
                );

              res.writeHead(
                200,
                {
                  'Content-Type':
                    'text/plain; charset=utf-8',

                  'Cache-Control':
                    'no-cache'
                }
              );

              res.end(
                content
              );

              return;
            }
          }

          res.writeHead(
            404,
            {
              'Content-Type':
                'text/plain'
            }
          );

          res.end(
            'Not Found'
          );

        } catch (error) {

          res.writeHead(
            500
          );

          res.end(
            'Internal Server Error'
          );
        }
      }
    );

  server.listen(
    PORT,
    '0.0.0.0',
    () => {

      console.log(
        `Subscription server running on port ${PORT}`
      );
    }
  );
}

// ==================== 上传 / 项目访问 ====================

async function uploadFiles() {

  if (!UPLOAD_URL) {
    return;
  }

  try {

    const content =
      fs.existsSync(
        path.join(
          subPath,
          'sub_base64.txt'
        )
      )
        ? fs.readFileSync(
            path.join(
              subPath,
              'sub_base64.txt'
            ),
            'utf8'
          )
        : '';

    if (!content) {
      return;
    }

    await axios.post(
      UPLOAD_URL,
      {
        content
      },
      {
        timeout: 15000
      }
    );

  } catch (error) {

    console.log(
      'Upload failed'
    );
  }
}

// ==================== 自动访问 ====================

async function autoAccess() {

  if (!AUTO_ACCESS) {
    return;
  }

  try {

    await axios.get(
      AUTO_ACCESS,
      {
        timeout: 10000
      }
    );

    console.log(
      'AUTO_ACCESS completed'
    );

  } catch (error) {

    console.log(
      'AUTO_ACCESS failed'
    );
  }
}

// ==================== 主程序 ====================

async function main() {

  console.log(
    '============================================'
  );

  console.log(
    ' VLESS + XHTTP deployment'
  );

  console.log(
    ' XHTTP mode: packet-up'
  );

  console.log(
    ' Cloudflare origin: 127.0.0.1:' +
    ARGO_PORT
  );

  console.log(
    '============================================'
  );

  // 创建目录
  fs.mkdirSync(
    FILE_PATH,
    {
      recursive: true
    }
  );

  fs.mkdirSync(
    subPath,
    {
      recursive: true
    }
  );

  // Reality
  initRealityKeys();

  // 证书
  generateCertificate();

  // Tunnel 配置
  argoType();

  // 下载程序
  const architecture =
    getArchitecture();

  const files =
    getFilesForArchitecture(
      architecture
    );

  for (
    const file of files
  ) {

    if (
      fs.existsSync(
        file.fileName
      )
    ) {

      console.log(
        `${file.fileName} already exists`
      );

      continue;
    }

    let downloaded =
      false;

    for (
      const url of file.fileUrls
    ) {

      console.log(
        `Downloading ${url}`
      );

      const ok =
        await downloadFile(
          url,
          file.fileName
        );

      if (ok) {

        downloaded =
          true;

        break;
      }
    }

    if (!downloaded) {

      console.error(
        `Failed to download ${file.fileName}`
      );
    }
  }

  // Xray 配置
  await generateConfig();

  console.log(
    'Xray config generated'
  );

  // Nezha
  await runNezha();

  // HTTP 订阅服务
  startSubscriptionServer();

  // Xray + Cloudflare
  await runServices();

  // 获取节点域名
  await extractDomains();

  // 上传
  await uploadFiles();

  // 自动访问
  await autoAccess();

  // Telegram
  if (
    BOT_TOKEN &&
    CHAT_ID
  ) {

    await sendTelegram(
      `XHTTP node deployed successfully\n\nDomain: ${ARGO_DOMAIN || 'Quick Tunnel'}\nPort: ${ARGO_PORT}\nMode: packet-up`
    );
  }

  console.log(
    '============================================'
  );

  console.log(
    'Deployment completed'
  );

  console.log(
    '============================================'
  );

  // =====================================================
  // 注意：
  // 不立即删除 config.json。
  // 保证 Xray 服务持续使用。
  // =====================================================
}

// ==================== 异常处理 ====================

process.on(
  'uncaughtException',
  error => {

    console.error(
      'Uncaught exception:',
      error
    );
  }
);

process.on(
  'unhandledRejection',
  error => {

    console.error(
      'Unhandled rejection:',
      error
    );
  }
);

// ==================== 启动 ====================

main()
  .catch(error => {

    console.error(
      'Main process error:',
      error
    );

    process.exit(1);
  });
