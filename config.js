const config = {
  TIME_SLEEP: 720, //minutes
  MAX_THREADS: 10,
  DELAY_START_BOT: [1, 12], //seconds

  ///captcha========
  TYPE_CAPTCHA: "2captcha", // valid values: 2captcha, anticaptcha
  API_KEY_2CAPTCHA: "xxx",
  API_KEY_ANTICAPTCHA: "xxx",
  RETIRES_CAPTCHA: 5,
  CAPTCHA_URL: "https://testnet.monad.xyz/",
  WEBSITE_KEY: "6LcItOMqAAAAAF9ANohQEN4jGOjHRxU8f5MNJZHu",
};

module.exports = { config };
