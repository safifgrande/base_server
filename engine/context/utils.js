const crypto = require('crypto')

class utils {
  constructor() {
    this.jwt = {
      encode: this.#jwt().encode.bind(this),
      decode: this.#jwt().decode.bind(this)
    }
    this.crypto = {
      hash: this.#crypto().hash.bind(this),
      hmac: this.#crypto().hmac.bind(this),
      encrypt: this.#crypto().encrypt.bind(this),
      decrypt: this.#crypto().decrypt.bind(this),
    }
  }

  #crypto() {
    const hash = (data) => {
      return crypto.createHash('sha256').update(data).digest('hex');
    }

    const hmac = (algorithm, key, data) => {
      return crypto.createHmac(algorithm, key).update(data).digest('hex');
    }

    /**
     * Encrypts data using AES-256-CBC encryption algorithm.
     * @param {string} text - The text to encrypt.
     * @param {string} key - The encryption key (must be 32 bytes for AES-256).
     * @param {string} iv - The initialization vector (must be 16 bytes).
     * @returns {string} - The encrypted text in base64 format.
     */
    const encrypt = (text, key, iv) => {
      const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key), Buffer.from(iv));
      let encrypted = cipher.update(text, 'utf8', 'base64');
      encrypted += cipher.final('base64');
      return encrypted;
    }

    /**
     * Decrypts data using AES-256-CBC encryption algorithm.
     * @param {string} encryptedText - The encrypted text to decrypt (base64 format).
     * @param {string} key - The decryption key (must be 32 bytes for AES-256).
     * @param {string} iv - The initialization vector (must be 16 bytes).
     * @returns {string} - The decrypted text.
     */
    const decrypt = (encryptedText, key, iv) => {
      const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key), Buffer.from(iv));
      let decrypted = decipher.update(encryptedText, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    }

    return Object.freeze({
      hash,
      hmac,
      encrypt,
      decrypt
    })
  }

  #jwt() {
    const encode = (header, payload, secret) => {
      const headerBase64 = Buffer.from(JSON.stringify(header)).toString('base64').replace(/=/g, '');
      const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64').replace(/=/g, '');
      const signature = crypto.createHmac('sha256', secret).update(`${headerBase64}.${payloadBase64}`).digest('base64').replace(/=/g, '');
      return `${headerBase64}.${payloadBase64}.${signature}`;
    }

    const decode = (token, secret) => {
      const [headerBase64, payloadBase64, signature] = token.split('.');
      const validSignature = crypto.createHmac('sha256', secret).update(`${headerBase64}.${payloadBase64}`).digest('base64').replace(/=/g, '');
      if (signature === validSignature) {
        const header = JSON.parse(Buffer.from(headerBase64, 'base64').toString('utf8'));
        const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
        return { header, payload };
      } else {
        throw new Error('Invalid JWT signature');
      }
    }

    return Object.freeze({ encode, decode })
  };
}

const utilsInstance = new utils();
module.exports = utilsInstance;