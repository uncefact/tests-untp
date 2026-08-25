# Decrypting encrypted credentials

An encrypted credential added to the Playground (uploaded, fetched by URL, or verified from a link set) becomes a locked card under an Encrypted heading on the Credentials tab. Decryption happens entirely in your browser: the key is used for the one decrypt call, is never stored, logged or sent anywhere, and clearing or refreshing the page discards it along with every card.

## What the Playground can decrypt

One envelope format is supported, the one the UNTP reference implementation's storage service writes:

```json
{
  "cipherText": "<base64>",
  "iv": "<base64, 12 bytes>",
  "tag": "<base64, 16 bytes>",
  "type": "aes-256-gcm"
}
```

The decryption key for it is the 64-character hexadecimal string (a 256-bit AES key) issued when the credential was stored. Entering it on the locked card decrypts the credential and runs it through the normal validation pipeline, with a leading Decryption step recording how the document was obtained.

## Everything else stays locked

Documents recognised as encrypted in another form, a JWE (compact or JSON serialisation), an AES variant other than `aes-256-gcm`, or an envelope whose fields do not match the shape above, are shown locked with the method named, and the card does not ask for a key that could not work. To validate such a credential today, provide its decrypted form instead.

If you hold credentials encrypted with a method the Playground does not support, please [raise an issue](https://github.com/uncefact/tests-untp/issues/new) naming the envelope format and where it comes from, so support can be prioritised.
