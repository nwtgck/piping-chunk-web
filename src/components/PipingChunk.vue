<template>
  <v-layout>
    <v-flex xs12 sm8 offset-sm2 offset-md3 md6>
      <v-card style="padding: 1em;">

        <v-btn-toggle v-model="sendOrGet" mandatory style="margin-bottom: 2em;">
          <v-btn text value="send">
            Send
            <v-icon right dark>file_upload</v-icon>
          </v-btn>
          <v-btn text value="get">
            Get
            <v-icon right dark>file_download</v-icon>
          </v-btn>
        </v-btn-toggle>

        <file-pond v-if="sendOrGet === 'send'"
                   ref="pond"
                   label-idle="<img src='img/file-icon.svg' style='width: 2em'><br>Drop a file here or <span class='filepond--label-action'>Browse</span>"
                   allow-multiple="false"
                   maxFiles="1"
        />
        <v-text-field label="Server URL"
                      v-model="serverUrl"
        />
        <v-text-field label="Data ID"
                      v-model="dataId"
                      placeholder="e.g. mydata"
        />
        <v-text-field label="Simultaneous requests"
                      v-model="nSimultaneousReqs"
                      type="number"
        />

        <v-text-field v-if="sendOrGet === 'send'"
                      label="Chunk bytes"
                      v-model="chunkByteSize"
                      type="number"
        />

        <v-btn v-if="sendOrGet === 'send'"
               color="primary"
               v-on:click="connect()"
               block
               :disabled="!enableActionButton">
          Connect
          <v-icon right dark>power</v-icon>
        </v-btn>
        <v-alert :value="sendOrGet === 'get' && !streamDownloadSupported"
                 type="warning"
        >
          This browser does NOT support stream-download.<br>
          Whole file data will be temporary on the memory.
        </v-alert>
        <v-btn v-if="sendOrGet === 'get'"
               color="secondary"
               v-on:click="get()"
               block
               :disabled="!enableActionButton">
          Get
          <v-icon right dark>file_download</v-icon>
        </v-btn>
        <span v-if="verificationCode !== ''">
          <v-alert type="info">
            <span style="font-size: 1.2em">Verification Code: <b>{{ verificationCode }}</b></span>
          </v-alert>

        <v-layout v-if="sendOrGet === 'send'">
          <v-flex xs6>
            <v-btn color="success"
                   @click="verifyAndSend()"
                   :disabled="disableVerifyOrAbortButtons"
                   block>
              <v-icon left dark>check</v-icon>
              Verify & Send
            </v-btn>
          </v-flex>
          <v-flex xs6>
            <v-btn color="error"
                   @click="abortSending()"
                   :disabled="disableVerifyOrAbortButtons"
                   block>
              <v-icon left dark>cancel</v-icon>
              Abort
            </v-btn>
          </v-flex>
        </v-layout>
        </span>

        <v-progress-linear
          v-show="progressSetting.show"
          :indeterminate="progressSetting.indeterminate"
          :value="progressSetting.percentage"
        />
      </v-card>
    </v-flex>
    <v-snackbar v-model="showsSnackbar"
                color="error">
      {{ snackbarMessage }}
    </v-snackbar>
  </v-layout>
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator';
import * as streamSaver from 'streamsaver'; // NOTE: load before streams polyfill to detect support
import * as fileSaver from 'file-saver';
import * as pipingChunk from '@/piping-chunk';
import * as utils from '@/utils';
import * as aes128gcmStream from 'aes128gcm-stream';
import {nul, bool, num, str, literal, opt, arr, tuple, obj, union, TsType, validatingParse} from 'ts-json-validator';
import {jwkThumbprintByEncoding} from 'jwk-thumbprint';
import urlJoin from 'url-join';

import vueFilePond from 'vue-filepond';
import 'filepond/dist/filepond.min.css';

const rsaOtherPrimesInfoFormat = obj({
  d: opt(str),
  r: opt(str),
  t: opt(str),
});

const jsonWebKeyFormat = obj({
  alg: opt(str),
  crv: opt(str),
  d: opt(str),
  dp: opt(str),
  dq: opt(str),
  e: opt(str),
  ext: opt(bool),
  k: opt(str),
  key_ops: opt(arr(str)),
  kty: opt(str),
  n: opt(str),
  oth: opt(arr(rsaOtherPrimesInfoFormat)),
  p: opt(str),
  q: opt(str),
  qi: opt(str),
  use: opt(str),
  x: opt(str),
  y: opt(str),
});

const ecJsonWebKeyFormat = obj({
  alg: opt(str),
  crv: opt(str),
  d: opt(str),
  dp: opt(str),
  dq: opt(str),
  e: opt(str),
  ext: opt(bool),
  k: opt(str),
  key_ops: opt(arr(str)),
  kty: literal('EC' as const),
  n: opt(str),
  oth: opt(arr(rsaOtherPrimesInfoFormat)),
  p: opt(str),
  q: opt(str),
  qi: opt(str),
  use: opt(str),
  x: opt(str),
  y: opt(str),
});

const rsaJsonWebKeyFormat = obj({
  alg: opt(str),
  crv: opt(str),
  d: opt(str),
  dp: opt(str),
  dq: opt(str),
  e: opt(str),
  ext: opt(bool),
  k: opt(str),
  key_ops: opt(arr(str)),
  kty: literal('RSA' as const),
  n: opt(str),
  oth: opt(arr(rsaOtherPrimesInfoFormat)),
  p: opt(str),
  q: opt(str),
  qi: opt(str),
  use: opt(str),
  x: opt(str),
  y: opt(str),
});

const keyExchangeParcelFormat = obj({
  kind: literal('key_exchange' as const),
  content: obj({
    // Public RSA key for signature
    rsaPublicJWk: rsaJsonWebKeyFormat,
    // Public key for encryption
    encryptPublicJwk: ecJsonWebKeyFormat,
    // Signature of thumbprint of public key for encryption
    encryptPublicJwkThumbprintSignature: str,
  }),
});
type KeyExchangeParcel = TsType<typeof keyExchangeParcelFormat>;

const verificationParcelFormat = obj({
  kind: literal('verification' as const),
  content: obj({
    verified: bool,
  }),
});
type VerificationParcel = TsType<typeof verificationParcelFormat>;

// Signature algorithm
const signAlg = { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } };

(async () => {
  try {
    const _ = TransformStream;
  } catch (err) {
    // Detect ReferenceError
    // Use polyfill
    const webStreamsPolyfill = await import('web-streams-polyfill');
    ReadableStream  = webStreamsPolyfill.ReadableStream;
    WritableStream  = webStreamsPolyfill.WritableStream;
    TransformStream = webStreamsPolyfill.TransformStream;
  }
})();

// Create component
const FilePond = vueFilePond();

// Generate verification code
async function generateVerificationCode(
  // NOTE: The order of arguments is not important
  rsaPublicJwk1: JsonWebKey & {kty: 'RSA'},
  rsaPublicJwk2: JsonWebKey & {kty: 'RSA'},
): Promise<string> {
  // Get thumbprints
  const rsaPublicThumbprint1: string = jwkThumbprintByEncoding(rsaPublicJwk1, 'SHA-256', 'hex');
  const rsaPublicThumbprint2: string = jwkThumbprintByEncoding(rsaPublicJwk2, 'SHA-256', 'hex');

  // NOTE: sort is for uniqueness
  return (await utils.sha256([
    rsaPublicThumbprint1,
    rsaPublicThumbprint2,
  ].sort().join('-'))).substring(0, 32);
}

/**
 * Key exchange
 * @param rsaKeyPair
 * @param encryptKeyPair
 * @param myUrl
 * @param peerUrl
 */
async function keyExchange(
  rsaKeyPair: CryptoKeyPair,
  encryptKeyPair: CryptoKeyPair,
  myUrl: string,
  peerUrl: string,
): Promise<{sharedKey: CryptoKey, verificationCode: string} | undefined> {
  // NOTE: kty should be 'EC' because it's ECDH key
  const encryptPublicJwk: JsonWebKey & {kty: 'EC'} = await crypto.subtle.exportKey(
    'jwk',
    encryptKeyPair.publicKey,
  ) as JsonWebKey & {kty: 'EC'};
  // Sign the public key for encryption and base64 encode
  const encryptPublicJwkThumbprintSignature: string = btoa(utils.arrayBufferToString(
    await window.crypto.subtle.sign(
      signAlg,
      rsaKeyPair.privateKey,
      jwkThumbprintByEncoding(encryptPublicJwk, 'SHA-256', 'uint8array'),
    ),
  ));
  // Get RSA public key as JWK
  const rsaPublicJWk = await crypto.subtle.exportKey(
    'jwk',
    rsaKeyPair.publicKey,
  ) as {kty: 'RSA'};
  const keyExchangeParcel: KeyExchangeParcel = {
    kind: 'key_exchange',
    content: {
      rsaPublicJWk,
      // Public key for encryption
      encryptPublicJwk: await crypto.subtle.exportKey(
        'jwk',
        encryptKeyPair.publicKey,
      ) as {kty: 'EC'}, // NOTE: kty is 'EC' logically
      encryptPublicJwkThumbprintSignature: encryptPublicJwkThumbprintSignature,
    },
  };
  // Exchange keys
  fetch(myUrl, {
    method: 'POST',
    body: JSON.stringify(keyExchangeParcel),
  });
  const res = await fetch(peerUrl);
  const peerKeyExchangeParcel = validatingParse(keyExchangeParcelFormat, await res.text());
  if (peerKeyExchangeParcel === undefined) {
    console.error('Format of peer\'s key exchange was wrong');
    return undefined;
  }
  // Get peer's RSA public key
  const peerRsaPublicJWk = peerKeyExchangeParcel.content.rsaPublicJWk;
  // Get peer's public for encryption
  const peerEncryptPublicJwk = peerKeyExchangeParcel.content.encryptPublicJwk;

  // Verify peer's public key for encryption by peer's public RSA key
  const verified = await crypto.subtle.verify(
    signAlg,
    await crypto.subtle.importKey('jwk', peerRsaPublicJWk, signAlg, true, ['verify']),
    utils.stringToArrayBuffer(atob(peerKeyExchangeParcel.content.encryptPublicJwkThumbprintSignature)),
    jwkThumbprintByEncoding(peerEncryptPublicJwk, 'SHA-256', 'uint8array'),
  );
  if (!verified) {
    console.error('Peer public key for encryption is not verified');
    return undefined;
  }

  const peerPublicKey: CryptoKey = await crypto.subtle.importKey(
    'jwk',
    peerEncryptPublicJwk,
    {name: 'ECDH', namedCurve: 'P-256'},
    true,
    [],
  );

  // Get shared key
  const sharedKey: CryptoKey = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: peerPublicKey },
    encryptKeyPair.privateKey,
    {name: 'AES-GCM', length: 128},
    true,
    ['encrypt', 'decrypt'],
  );
  return {
    sharedKey,
    // Generate verification code
    verificationCode: await generateVerificationCode(
      rsaPublicJWk,
      peerRsaPublicJWk,
    ),
  };
}

@Component({
  components: {
    FilePond,
  },
})
export default class PipingChunk extends Vue {
  private sendOrGet: 'send' | 'get' = 'send';
  private dataId: string = '';
  // TODO: Hard code
  private serverUrl: string = 'https://ppng.io';
  private nSimultaneousReqs: number = 2;
  private chunkByteSize: number = 65536; // NOTE: About 65KB
  // Progress bar setting
  private readonly progressSetting: {show: boolean, indeterminate: boolean, percentage: number} = {
    show: false,
    indeterminate: false,
    percentage: 0,
  };
  private readonly aesGcmIvLength: number = 12;
  private verificationCode: string = '';
  private sharedKey?: CryptoKey;
  // Whether send/get button is available
  private enableActionButton: boolean = true;
  // Show snackbar
  private showsSnackbar: boolean = false;
  // Message of snackbar
  private snackbarMessage: string = '';
  // Whether stream-download is supported
  private readonly streamDownloadSupported = streamSaver.supported;
  private disableVerifyOrAbortButtons: boolean = true;

  // RSA keys for signature
  private rsaKeyPairPromise: PromiseLike<CryptoKeyPair> = this.generateRsaKeyPair();
  // Key pair for encryption
  private encryptKeyPairPromise: PromiseLike<CryptoKeyPair> = this.generateEncryptKeyPair();

  private generateRsaKeyPair(): PromiseLike<CryptoKeyPair> {
    return crypto.subtle.generateKey(
      {...signAlg, modulusLength: 4096,  publicExponent: new Uint8Array([0x01, 0x00, 0x01]) },
      true,
      ['sign', 'verify'],
    );
  }

  private generateEncryptKeyPair(): PromiseLike<CryptoKeyPair> {
    return crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256'},
      true,
      ['deriveKey', 'deriveBits'],
    );
  }

  // Update key-pairs for ephemeralness
  private updateKeyPairs(): void {
    this.rsaKeyPairPromise     = this.generateRsaKeyPair();
    this.encryptKeyPairPromise = this.generateEncryptKeyPair();
  }

  // Show error message
  private showSnackbar(message: string): void {
    this.showsSnackbar = true;
    this.snackbarMessage = message;
  }

  private async key(): Promise<Uint8Array | undefined> {
    return this.sharedKey === undefined ?
      undefined :
      new Uint8Array(await crypto.subtle.exportKey('raw', this.sharedKey));
  }

  /**
   * Encrypt parcel attached IV on head
   * @param verificationParcel
   * @param sharedKey
   */
  private async encryptParcel(verificationParcel: VerificationParcel): Promise<Blob> {
    // Create an initialization vector
    const iv = crypto.getRandomValues(new Uint8Array(this.aesGcmIvLength));
    // Get shared key
    const sharedKey = this.sharedKey!;
    // Encrypt parcel
    const encryptedParcel = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      sharedKey,
      // (from: https://stackoverflow.com/a/41180394/2885946)
      new TextEncoder().encode(JSON.stringify(verificationParcel)),
    );
    // Join IV and encrypted parcel
    return new Blob([iv, encryptedParcel]);
  }

  private async keyExchangeUrl(type: 'sender' | 'receiver'): Promise<string> {
    return urlJoin(this.serverUrl, await utils.sha256(`${this.dataId}/key_exchange/${type}`));
  }

  private async verificationUrl(): Promise<string> {
    return urlJoin(this.serverUrl, await utils.sha256(`${this.dataId}/${this.verificationCode}/verification`));
  }

  private async connect() {
    // Get file in FilePond
    const pondFile: {file: File} | null = (this.$refs.pond as any).getFile();
    if (pondFile === null) {
      // Show error message
      this.showSnackbar('Error: No file selected');
      return;
    }
    // If Data ID is empty
    if (this.dataId === '') {
      // Show error message
      this.showSnackbar('Error: Data ID is required');
      return;
    }
    // Disable the button
    this.enableActionButton = false;

    // Exchange key and Get key
    const keyExchangeRes = await keyExchange(
      await this.rsaKeyPairPromise,
      await this.encryptKeyPairPromise,
      await this.keyExchangeUrl('sender'),
      await this.keyExchangeUrl('receiver'),
    );
    if (keyExchangeRes === undefined) {
      console.error('Error in key exchange');
      // Update key-pairs for ephemeralness
      this.updateKeyPairs();
      return;
    }
    // Extract
    const {sharedKey, verificationCode} = keyExchangeRes;
    // Assign shared key
    this.sharedKey = sharedKey;
    // Assign verification code
    this.verificationCode = verificationCode;
    // Enable [verify] and [abort] buttons
    this.disableVerifyOrAbortButtons = false;
  }

  private async sendVerification(verified: boolean) {
    const verificationParcel: VerificationParcel = {
      kind: 'verification',
      content: {
        verified,
      },
    };
    // Encrypt
    const encrypted: Blob = await this.encryptParcel(verificationParcel);
    await fetch(await this.verificationUrl(), {
      method: 'POST',
      body: encrypted,
    });
  }

  private async verifyAndSend() {
    // Disable [verify] and [abort] buttons
    this.disableVerifyOrAbortButtons = true;
    // Verify: true
    await this.sendVerification(true);
    // Send
    await this.send();
  }

  private async abortSending() {
    // Disable [verify] and [abort] buttons
    this.disableVerifyOrAbortButtons = true;
    // Verify: false
    await this.sendVerification(false);
    // Enable the button again
    this.enableActionButton = true;
    // Delete verification code and hide
    this.verificationCode = '';
    // Update key-pairs for ephemeralness
    this.updateKeyPairs();
  }

  private async send() {
    // Get file in FilePond
    const pondFile: {file: File} | null = (this.$refs.pond as any).getFile();
    if (pondFile === null) {
      // Show error message
      this.showSnackbar('Error: No file selected');
      // Update key-pairs for ephemeralness
      this.updateKeyPairs();
      return;
    }

    // Get the file
    const file: File = pondFile.file;

    // Create ReadableStream from a file
    const fileReadableStream = utils.createFileReadableStream(file, this.chunkByteSize);

    // Get total size
    const totalSize: number = file.size;
    // Show progress bar
    this.progressSetting.show = true;
    // Disable indeterminate always
    this.progressSetting.indeterminate = false;
    // Set initial percentage
    this.progressSetting.percentage = 0;

    // Stream for progress bar
    const progressStream: ReadableStream<Uint8Array> =
      utils.getPregressReadableStream(fileReadableStream, (currentSize) => {
        this.progressSetting.percentage = (currentSize / totalSize) * 100;
      });

    // Create upload stream
    const uploadStream: ReadableStream<Uint8Array> = aes128gcmStream.encryptStream(
      progressStream,
      // NOTE: This should not be undefined
      (await this.key())!,
    );

    // Send
    const sendPromise: Promise<void> = pipingChunk.sendReadableStream(
      uploadStream,
      this.nSimultaneousReqs,
      this.serverUrl,
      `${this.dataId}/${this.verificationCode}`,
    );

    sendPromise.finally(() => {
      // Enable the button again
      this.enableActionButton = true;
      // Delete verification code and hide
      this.verificationCode = '';
      // Update key-pairs for ephemeralness
      this.updateKeyPairs();
    });
  }

  private async get(): Promise<void> {
    // If Data ID is empty
    if (this.dataId === '') {
      // Show error message
      this.showSnackbar('Error: Data ID is required');
      return;
    }
    // Disable the button
    this.enableActionButton = false;

    // Exchange key and Get key
    const keyExchangeRes = await keyExchange(
      await this.rsaKeyPairPromise,
      await this.encryptKeyPairPromise,
      await this.keyExchangeUrl('receiver'),
      await this.keyExchangeUrl('sender'),
    );
    if (keyExchangeRes === undefined) {
      console.error('Error in key exchange');
      // Update key-pairs for ephemeralness
      this.updateKeyPairs();
      return;
    }
    // Extract
    const {sharedKey, verificationCode} = keyExchangeRes;
    this.sharedKey = sharedKey;
    // Assign verification code
    this.verificationCode = verificationCode;

    const res = await fetch(await this.verificationUrl());
    // Get body
    const body: Uint8Array = await utils.getBodyBytesFromResponse(res);
    // Split body into IV and encrypted parcel
    const iv = body.slice(0, this.aesGcmIvLength);
    const encryptedParcel = body.slice(this.aesGcmIvLength);
    // Decrypt body text
    const decryptedParcel: ArrayBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      this.sharedKey,
      encryptedParcel,
    );
    // Parse
    const verificationParcel: VerificationParcel | undefined = validatingParse(
      verificationParcelFormat,
      // (from: https://stackoverflow.com/a/41180394/2885946)
      new TextDecoder().decode(decryptedParcel),
    );
    if (verificationParcel === undefined) {
      console.error('Format error of verificationParcel');
      // Update key-pairs for ephemeralness
      this.updateKeyPairs();
      return;
    }
    if (!verificationParcel.content.verified) {
      // Show error message
      this.showSnackbar('Sender aborts');
      // Enable the button again
      this.enableActionButton = true;
      // Delete verification code and hide
      this.verificationCode = '';
      // Update key-pairs for ephemeralness
      this.updateKeyPairs();
      return;
    }

    // Show progress bar
    this.progressSetting.show = true;
    // Enable indeterminate because it does NOT has percentage
    this.progressSetting.indeterminate = true;

    // Create get-readable-stream
    const readableStream = pipingChunk.getReadableStream(
      this.nSimultaneousReqs,
      this.serverUrl,
      `${this.dataId}/${this.verificationCode}`,
    );

    // Create download stream
    const downloadStream: ReadableStream<Uint8Array> = aes128gcmStream.decryptStream(
      readableStream,
      // NOTE: This should not be undefined
      (await this.key())!,
    );

    // Use data ID as file name
    const filename = this.dataId;

    // If stream-download is supported
    if (streamSaver.supported) {
      // Save as file streamingly
      await downloadStream.pipeTo(
        streamSaver.createWriteStream(filename),
      );
    } else {
      // Read up chunks and generate blob
      const chunks: Uint8Array[] = [];
      const reader = downloadStream.getReader();
      while (true) {
        const {done, value} = await reader.read();
        if (done) {
          break;
        }
        chunks.push(value);
      }
      // Create a blob from chunks
      const blob = new Blob(chunks);
      // Save
      fileSaver.saveAs(blob, filename);
    }

    // Disable indeterminate because finished
    this.progressSetting.indeterminate = false;
    // Set percentage as 100%
    this.progressSetting.percentage    = 100;
    // Enable the button again
    this.enableActionButton = true;
    // Delete verification code and hide
    this.verificationCode = '';
    // Update key-pairs for ephemeralness
    this.updateKeyPairs();
  }
}

</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
</style>
