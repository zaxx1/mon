const fs = require("fs");
const path = require("path");
const axios = require("axios");
const colors = require("colors");
const { HttpsProxyAgent } = require("https-proxy-agent");
const readline = require("readline");
const user_agents = require("./config/userAgents");
const { sleep, loadData, getRandomNumber, saveJson } = require("./utils");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const { checkBaseUrl } = require("./checkAPI");
const headers = require("./core/header");
const { config } = require("./config");
class ClientAPI {
  constructor(queryId, accountIndex, proxy, baseURL, localStorage) {
    this.headers = headers;
    this.baseURL = baseURL;
    this.queryId = queryId;
    this.accountIndex = accountIndex;
    this.proxy = proxy;
    this.proxyIP = null;
    this.session_name = null;
    this.session_user_agents = this.#load_session_data();
    this.token = queryId;
    this.localStorage = localStorage;
    this.localData = {};
  }

  #load_session_data() {
    try {
      const filePath = path.join(process.cwd(), "session_user_agents.json");
      const data = fs.readFileSync(filePath, "utf8");
      return JSON.parse(data);
    } catch (error) {
      if (error.code === "ENOENT") {
        return {};
      } else {
        throw error;
      }
    }
  }

  #get_random_user_agent() {
    const randomIndex = Math.floor(Math.random() * user_agents.length);
    return user_agents[randomIndex];
  }

  #get_user_agent() {
    if (this.session_user_agents[this.session_name]) {
      return this.session_user_agents[this.session_name];
    }

    console.log(`[Tài khoản ${this.accountIndex + 1}] Tạo user agent...`.blue);
    const newUserAgent = this.#get_random_user_agent();
    this.session_user_agents[this.session_name] = newUserAgent;
    this.#save_session_data(this.session_user_agents);
    return newUserAgent;
  }

  #save_session_data(session_user_agents) {
    const filePath = path.join(process.cwd(), "session_user_agents.json");
    fs.writeFileSync(filePath, JSON.stringify(session_user_agents, null, 2));
  }

  #get_platform(userAgent) {
    const platformPatterns = [
      { pattern: /iPhone/i, platform: "ios" },
      { pattern: /Android/i, platform: "android" },
      { pattern: /iPad/i, platform: "ios" },
    ];

    for (const { pattern, platform } of platformPatterns) {
      if (pattern.test(userAgent)) {
        return platform;
      }
    }

    return "Unknown";
  }

  #set_headers() {
    const platform = this.#get_platform(this.#get_user_agent());
    this.headers["sec-ch-ua"] = `Not)A;Brand";v="99", "${platform} WebView";v="127", "Chromium";v="127`;
    this.headers["sec-ch-ua-platform"] = platform;
    this.headers["User-Agent"] = this.#get_user_agent();
  }

  createUserAgent() {
    try {
      this.session_name = this.queryId;
      this.#get_user_agent();
    } catch (error) {
      this.log(`Can't create user agent, try get new query_id: ${error.message}`, "error");
      return;
    }
  }

  async log(msg, type = "info") {
    const accountPrefix = `[Account ${this.accountIndex + 1}][${this.queryId}]`;
    const ipPrefix = this.proxyIP ? `[${this.proxyIP}]` : "[Local IP]";
    let logMessage = "";

    switch (type) {
      case "success":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.green;
        break;
      case "error":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.red;
        break;
      case "warning":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.yellow;
        break;
      case "custom":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.magenta;
        break;
      default:
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.blue;
    }
    console.log(logMessage);
  }

  async checkProxyIP() {
    try {
      const proxyAgent = new HttpsProxyAgent(this.proxy);
      const response = await axios.get("https://api.ipify.org?format=json", { httpsAgent: proxyAgent });
      if (response.status === 200) {
        this.proxyIP = response.data.ip;
        return response.data.ip;
      } else {
        throw new Error(`Cannot check proxy IP. Status code: ${response.status}`);
      }
    } catch (error) {
      throw new Error(`Error checking proxy IP: ${error.message}`);
    }
  }

  solveCaptcha = async () => {
    switch (config.TYPE_CAPTCHA) {
      case "2captcha":
        return await this.solve2Captcha();
      case "anticaptcha":
        return await this.solveAntiCaptcha();
      default:
        console.log("Invalid type captcha.".red);
        process.exit(1);
    }
  };

  solve2Captcha = async () => {
    let retries = config.RETIRES_CAPTCHA;
    try {
      // Step 1: Create a CAPTCHA task
      const taskResponse = await axios.post(
        "https://api.2captcha.com/createTask",
        {
          clientKey: config.API_KEY_2CAPTCHA,
          task: {
            type: "RecaptchaV2TaskProxyless",
            websiteURL: config.CAPTCHA_URL,
            websiteKey: config.WEBSITE_KEY,
            isInvisible: false,
          },
        },
        {
          headers: { "Content-Type": "application/json" },
        }
      );

      const requestId = taskResponse.data.taskId;
      // Step 2: Poll for the result
      let result;
      do {
        await new Promise((resolve) => setTimeout(resolve, 10000));
        const resultResponse = await axios.post(
          "https://api.2captcha.com/getTaskResult",
          {
            clientKey: config.API_KEY_2CAPTCHA,
            taskId: requestId,
          },
          {
            headers: {
              "Content-Type": "application/json",
            },
          }
        );
        result = resultResponse.data;
        if (result.status === "processing") {
          this.log("CAPTCHA still processing...".yellow);
        }
        retries--;
      } while (result.status === "processing" && retries > 0);

      // Step 3: Use the CAPTCHA solution
      if (result.status === "ready") {
        this.log("CAPTCHA success..".green);
        const captchaSolution = result.solution.token; // This is the CAPTCHA token

        // Use the token in your request
        return captchaSolution; // Store the token for further use

        // You can now send this token to the backend or use it as needed
      } else {
        this.log(`Error ${JSON.stringify(result)}`, "error");
        return null;
      }
    } catch (error) {
      this.log("Error: " + error.message, "error");
      return null;
    }
  };

  solveAntiCaptcha = async () => {
    let retries = config.RETIRES_CAPTCHA;
    try {
      // Step 1: Create a CAPTCHA task
      const taskResponse = await axios.post(
        "https://api.anti-captcha.com/createTask",
        {
          clientKey: config.API_KEY_ANTICAPTCHA,
          task: {
            type: "NoCaptchaTaskProxyless",
            websiteURL: config.CAPTCHA_URL,
            websiteKey: config.WEBSITE_KEY,
          },
        },
        {
          headers: { "Content-Type": "application/json" },
        }
      );

      const requestId = taskResponse.data.taskId;

      // Step 2: Poll for the result
      let result;
      do {
        await new Promise((resolve) => setTimeout(resolve, 10000));
        const resultResponse = await axios.post(
          "https://api.anti-captcha.com/getTaskResult",
          {
            clientKey: config.API_KEY_ANTICAPTCHA,
            taskId: requestId,
          },
          {
            headers: {
              "Content-Type": "application/json",
            },
          }
        );
        result = resultResponse.data;

        if (result.status === "processing") {
          this.log("CAPTCHA still processing...".yellow);
        }
        retries--;
      } while (result.status === "processing" && retries > 0);

      // Step 3: Use the CAPTCHA solution
      if (result.status === "ready") {
        this.log("CAPTCHA solved successfully.".green);
        const captchaSolution = result.solution.gRecaptchaResponse; // This is the CAPTCHA token

        // Use the token in your request
        return captchaSolution; // Store the token for further use

        // You can now send this token to the backend or use it as needed
      } else {
        this.log(`Erro ${JSON.stringify(result)}`, "error");
        return null;
      }
    } catch (error) {
      this.log("Error: " + error.message, "error");

      return null;
    }
  };

  generateId() {
    const characters = "0123456789abcdef";
    let result = "";
    for (let i = 0; i < 32; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
  }

  async handleFaucet() {
    try {
      let proxyAgent = null;
      if (this.proxyIP) {
        proxyAgent = new HttpsProxyAgent(this.proxy);
      }
      const token = await this.solveCaptcha();
      if (!token) {
        return { data: null, success: false, mess: "Failed to solve CAPTCHA" };
      }
      // visitorId: "6472a032e0463dc05e360ca334f00e18",
      const payload = {
        address: this.queryId,
        visitorId: this.generateId(),
        // visitorId: "6472a032e0463dc05e360ca334f00e18",
        recaptchaToken: token,
      };
      const response = await axios({
        method: "POST",
        url: "https://testnet.monad.xyz/api/claim",
        headers: {
          accept: "*/*",
          "accept-language": "en-US,en;q=0.7",
          "content-type": "application/json",
          origin: "https://testnet.monad.xyz",
          referer: "https://testnet.monad.xyz/",
          "user-agent": this.#get_user_agent(this.session_name) || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
        },
        httpsAgent: proxyAgent,
        data: payload,
      });

      if (response.data.message === "Success") {
        this.log(`Faucet successful! | ${new Date().toLocaleString()}`, "success");
        saveJson(this.session_name, { lastFaucet: new Date(), ip: this.proxyIP }, "localStorage.json");
        return true;
      } else {
        console.log(`Faucet failed: ${response.data.message}`.yellow);
        return false;
      }
    } catch (error) {
      this.log(`Error performing Faucet: ${JSON.stringify(error.response?.data || error.message)}`.red);
      return false;
    }
  }

  async runAccount() {
    const wallet = this.queryId;
    const accountIndex = this.accountIndex;
    this.session_name = wallet;
    this.localData = this.localStorage[this.session_name];
    this.#set_headers();

    try {
      this.proxyIP = await this.checkProxyIP();
    } catch (error) {
      this.log(`Cannot check proxy IP: ${error.message}`, "warning");
      return;
    }
    const timesleep = getRandomNumber(config.DELAY_START_BOT[0], config.DELAY_START_BOT[1]);
    console.log(`=========Tài khoản ${accountIndex + 1} | ${wallet} | ${this.proxyIP} | Bắt đầu sau ${timesleep} giây...`.green);

    await sleep(timesleep);
    const lastFaucet = this.localData?.lastFaucet;
    if (!isToday(lastFaucet) || !lastFaucet) {
      this.log("Starting faucet monad...");
      await this.handleFaucet();
    } else {
      const initialDate = new Date(lastFaucet);
      const newDate = new Date(initialDate.getTime() + 12 * 60 * 60 * 1000);
      this.log(`You faucet already today | Latest faucet: ${initialDate.toLocaleString()} | Next faucet: ${newDate.toLocaleString()}`.yellow);
    }
  }
}

const isToday = (checkInDate) => {
  const checkIn = new Date(checkInDate);
  const now = new Date();

  // Set the time of both dates to midnight (00:00:00) for comparison
  const hoursDiff = (now - checkIn) / (1000 * 60 * 60);
  return hoursDiff <= 12; // Returns true if checked in today
};

async function runWorker(workerData) {
  const { queryId, accountIndex, proxy, hasIDAPI, localStorage } = workerData;
  const to = new ClientAPI(queryId, accountIndex, proxy, hasIDAPI, localStorage);
  try {
    await Promise.race([to.runAccount(), new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 24 * 60 * 60 * 1000))]);
    parentPort.postMessage({
      accountIndex,
    });
  } catch (error) {
    parentPort.postMessage({ accountIndex, error: error.message });
  } finally {
    if (!isMainThread) {
      parentPort.postMessage("taskComplete");
    }
  }
}

async function main() {
  const queryIds = loadData("wallets.txt");
  const proxies = loadData("proxy.txt");
  const localStorage = require("./localStorage.json");

  if (queryIds.length > proxies.length) {
    console.log("Số lượng proxy và data phải bằng nhau.".red);
    console.log(`Data: ${queryIds.length}`);
    console.log(`Proxy: ${proxies.length}`);
    process.exit(1);
  }
  console.log("Tool được phát triển bởi nhóm tele Airdrop Hunter Siêu Tốc (https://t.me/airdrophuntersieutoc)".yellow);

  let maxThreads = config.MAX_THREADS;

  const { endpoint: hasIDAPI, message } = await checkBaseUrl();
  if (!hasIDAPI) return console.log(`Không thể tìm thấy ID API, thử lại sau!`.red);
  console.log(`${message}`.yellow);
  // process.exit();
  queryIds.map((val, i) => new ClientAPI(val, i, proxies[i], hasIDAPI, {}).createUserAgent());

  await sleep(1);
  while (true) {
    let currentIndex = 0;
    const errors = [];

    while (currentIndex < queryIds.length) {
      const workerPromises = [];
      const batchSize = Math.min(maxThreads, queryIds.length - currentIndex);
      for (let i = 0; i < batchSize; i++) {
        const worker = new Worker(__filename, {
          workerData: {
            hasIDAPI,
            queryId: queryIds[currentIndex],
            accountIndex: currentIndex,
            proxy: proxies[currentIndex % proxies.length],
            localStorage,
          },
        });

        workerPromises.push(
          new Promise((resolve) => {
            worker.on("message", (message) => {
              if (message === "taskComplete") {
                worker.terminate();
              }
              // console.log(message);
              resolve();
            });
            worker.on("error", (error) => {
              console.log(`Lỗi worker cho tài khoản ${currentIndex}: ${error.message}`);
              worker.terminate();
              resolve();
            });
            worker.on("exit", (code) => {
              worker.terminate();
              if (code !== 0) {
                errors.push(`Worker cho tài khoản ${currentIndex} thoát với mã: ${code}`);
              }
              resolve();
            });
          })
        );

        currentIndex++;
      }

      await Promise.all(workerPromises);

      if (errors.length > 0) {
        errors.length = 0;
      }

      if (currentIndex < queryIds.length) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }

    await sleep(3);
    console.log("Tool được phát triển bởi nhóm tele Airdrop Hunter Siêu Tốc (https://t.me/airdrophuntersieutoc)".yellow);
    console.log(`=============Hoàn thành tất cả tài khoản | Chờ ${config.TIME_SLEEP} phút=============`.magenta);
    await sleep(config.TIME_SLEEP * 60);
  }
}

if (isMainThread) {
  main().catch((error) => {
    console.log("Lỗi rồi:", error);
    process.exit(1);
  });
} else {
  runWorker(workerData);
}
