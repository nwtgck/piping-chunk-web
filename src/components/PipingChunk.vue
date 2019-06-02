<template>
  <v-layout>
    <v-flex xs12 sm8 offset-sm2 offset-md3 md6>
      <v-card style="padding: 1em;">

        <v-btn-toggle v-model="sendOrGet" mandatory style="margin-bottom: 2em;">
          <v-btn flat value="send">
            Send
            <v-icon right dark>file_upload</v-icon>
          </v-btn>
          <v-btn flat value="get">
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
<!--        <v-text-field label="Passphrase (optional)"-->
<!--                      v-model="passphrase"-->
<!--                      placeholder="Input passphrase"-->
<!--                      :type="showPassphrase ? 'text' : 'password'"-->
<!--                      :append-icon="showPassphrase ? 'visibility' : 'visibility_off'"-->
<!--                      @click:append="showPassphrase = !showPassphrase"-->
<!--        />-->
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
               v-on:click="send()"
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
        <v-alert type="info" value="true"
        >
          <span style="font-size: 1.2em">Verification Code: 934f234d54d3439da0</span>
        </v-alert>

        <v-layout v-if="sendOrGet === 'send'">
          <v-flex xs6>
            <v-btn color="success"
                   block>
              <v-icon right dark>check</v-icon>
              Verify & Send
            </v-btn>
          </v-flex>
          <v-flex xs6>
            <v-btn color="error"
                   block>
              <v-icon right dark>cancel</v-icon>
              Abort
            </v-btn>
          </v-flex>
        </v-layout>

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

const keyExchangeParcelFormat = obj({
  kind: literal('key_exchange' as const),
  content: obj({
    // Public key for verification code generation
    verificationCodePublicJwk: jsonWebKeyFormat,
    // Public key for encryption
    encryptPublicJwk: jsonWebKeyFormat,
  }),
});
type KeyExchangeParcel = TsType<typeof keyExchangeParcelFormat>;

const VerificationParcelFormat = obj({
  kind: literal('verification' as const),
  content: obj({
    verified: bool,
  }),
});
type VerificationParcel = TsType<typeof VerificationParcelFormat>;

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

@Component({
  components: {
    FilePond,
  },
})
export default class PipingChunk extends Vue {
  private sendOrGet: 'send' | 'get' = 'send';
  private dataId: string = '';
  private passphrase: string = '';
  private showPassphrase: boolean = false;
  // TODO: Hard code
  private serverUrl: string = 'https://ppng.ml';
  private nSimultaneousReqs: number = 2;
  private chunkByteSize: number = 65536; // NOTE: About 65KB
  // Progress bar setting
  private progressSetting: {show: boolean, indeterminate: boolean, percentage: number} = {
    show: false,
    indeterminate: false,
    percentage: 0,
  };
  // Whether send/get button is available
  private enableActionButton: boolean = true;
  // Show snackbar
  private showsSnackbar: boolean = false;
  // Message of snackbar
  private snackbarMessage: string = '';
  // Whether stream-download is supported
  private readonly streamDownloadSupported = streamSaver.supported;

  // Show error message
  private showSnackbar(message: string): void {
    this.showsSnackbar = true;
    this.snackbarMessage = message;
  }

  private async send() {
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

    // Key pair to create verification code
    const verificationCodeKeyPair: CryptoKeyPair = await window.crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256'},
      true,
      ['deriveKey', 'deriveBits'],
    );
    // Key pair for encryption
    const encryptKeyPair: CryptoKeyPair = await window.crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256'},
      true,
      ['deriveKey', 'deriveBits'],
    );
    const keyExchangeParcel: KeyExchangeParcel = {
      kind: 'key_exchange',
      content: {
        verificationCodePublicJwk: await crypto.subtle.exportKey(
          'jwk',
          verificationCodeKeyPair.publicKey,
        ),
        // Public key for encryption
        encryptPublicJwk: await crypto.subtle.exportKey(
          'jwk',
          encryptKeyPair.publicKey,
        ),
      },
    };
    console.log(keyExchangeParcel);
    // Exchange keys
    // TODO: SHA path
    fetch(`${this.serverUrl}/${this.dataId}/verification/sender`, {
      method: 'POST',
      body: JSON.stringify(keyExchangeParcel),
    });
    // TODO: SHA path
    const res = await fetch(`${this.serverUrl}/${this.dataId}/verification/receiver`);
    const receiverKeyExchangeParcel = validatingParse(keyExchangeParcelFormat, await res.text());
    if (receiverKeyExchangeParcel === undefined) {
      console.error('Format of receiver\'s key exchange was wrong');
      return;
    }
    const receiverPublicKey: CryptoKey = await crypto.subtle.importKey(
      'jwk',
      receiverKeyExchangeParcel.content.encryptPublicJwk,
      {name: 'ECDH', namedCurve: 'P-256'},
      true,
      [],
    );
    // Get shared key
    const sharedKey: CryptoKey = await crypto.subtle.deriveKey(
      { name: 'ECDH', public: receiverPublicKey },
      encryptKeyPair.privateKey,
      {name: 'AES-GCM', length: 128},
      true,
      ['encrypt', 'decrypt'],
    );
    // Convert shared key into Uint8Array
    const key: Uint8Array = new Uint8Array(await crypto.subtle.exportKey('raw', sharedKey));

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
    const uploadStream: ReadableStream<Uint8Array> = await (async () => {
      // If passphrase is empty
      if (this.passphrase === '') {
        return progressStream;
      } else {
        // // Generate key from passphrase by SHA-2156
        // const key = await utils.passphraseToKey(this.passphrase);
        // Encrypt
        return aes128gcmStream.encryptStream(
          progressStream,
          key,
        );
      }
    })();

    // Send
    const sendPromise: Promise<void> = pipingChunk.sendReadableStream(
      uploadStream,
      this.nSimultaneousReqs,
      this.serverUrl,
      this.dataId,
    );

    sendPromise.finally(() => {
      // Enable the button again
      this.enableActionButton = true;
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

    // Key pair to create verification code
    const verificationCodeKeyPair: CryptoKeyPair = await window.crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256'},
      true,
      ['deriveKey', 'deriveBits'],
    );
    // Key pair for encryption
    const encryptKeyPair: CryptoKeyPair = await window.crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256'},
      true,
      ['deriveKey', 'deriveBits'],
    );
    const keyExchangeParcel: KeyExchangeParcel = {
      kind: 'key_exchange',
      content: {
        verificationCodePublicJwk: await window.crypto.subtle.exportKey(
          'jwk',
          verificationCodeKeyPair.publicKey,
        ),
        // Public key for encryption
        encryptPublicJwk: await window.crypto.subtle.exportKey(
          'jwk',
          encryptKeyPair.publicKey,
        ),
      },
    };
    console.log(keyExchangeParcel);
    // Exchange keys
    // TODO: SHA path
    fetch(`${this.serverUrl}/${this.dataId}/verification/receiver`, {
      method: 'POST',
      body: JSON.stringify(keyExchangeParcel),
    });
    // TODO: SHA path
    const res = await fetch(`${this.serverUrl}/${this.dataId}/verification/sender`);
    const senderKeyExchangeParcel = validatingParse(keyExchangeParcelFormat, await res.text());
    if (senderKeyExchangeParcel === undefined) {
      console.error('Format of sender\'s key exchange was wrong');
      return;
    }
    const receiverPublicKey: CryptoKey = await crypto.subtle.importKey(
      'jwk',
      senderKeyExchangeParcel.content.encryptPublicJwk,
      {name: 'ECDH', namedCurve: 'P-256'},
      true,
      [],
    );
    // Get shared key
    const sharedKey: CryptoKey = await crypto.subtle.deriveKey(
      { name: 'ECDH', public: receiverPublicKey },
      encryptKeyPair.privateKey,
      {name: 'AES-GCM', length: 128},
      true,
      ['encrypt', 'decrypt'],
    );
    // Convert shared key into Uint8Array
    const key: Uint8Array = new Uint8Array(await crypto.subtle.exportKey('raw', sharedKey));

    // Show progress bar
    this.progressSetting.show = true;
    // Enable indeterminate because it does NOT has percentage
    this.progressSetting.indeterminate = true;

    // Create get-readable-stream
    const readableStream = pipingChunk.getReadableStream(
      this.nSimultaneousReqs,
      this.serverUrl,
      this.dataId,
    );


    // Create download stream
    const downloadStream: ReadableStream<Uint8Array> = await (async () => {
      // If passphrase is empty
      if (this.passphrase === '') {
        return readableStream;
      } else {
        // // Generate key from passphrase by SHA-2156
        // const key = await utils.passphraseToKey(this.passphrase);
        return aes128gcmStream.decryptStream(
          readableStream,
          key,
        );
      }
    })();

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
  }
}

</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
</style>
