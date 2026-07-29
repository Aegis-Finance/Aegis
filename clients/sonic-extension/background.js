const SONIC_RPC_URL = "https://rpc.soniclabs.com"
const REGISTRY_ADDRESS = "0xDe1DAdcF11a7447C3D093e97FdbD513f488cE3b4"
const ARWEAVE_GATEWAYS = [
  "https://arweave.net/",
  "https://ar-io.net/",
  "https://arweave.live/",
  "https://gateway.arweave.net/",
  "https://arweave.dev/",
  "https://gateway.irys.xyz/",
  "https://arweave-search.goldsky.com/",
  "https://arweave.news/",
  "https://ar-io.dev/",
  "https://arweave.cache.holaplex.com/",
]
const RECORD_KEY = "arweave.html.value"
const DEFAULT_DOMAIN = "agscoin.sonic"
const DEFAULT_MANIFEST_ID = "kCjLofdpwSgFLE-c96kt6HW32jHw5nM6x3_XioCQGps"

function isAllowedUserNavigationUrl(url) {
  try {
    var u = new URL(url)
    if (u.protocol !== "https:") return false
    var h = u.hostname.toLowerCase()
    if (
      h === "arweave.net" ||
      h === "ar-io.net" ||
      h === "arweave.live" ||
      h === "gateway.arweave.net" ||
      h === "arweave.dev" ||
      h === "gateway.irys.xyz" ||
      h === "arweave-search.goldsky.com" ||
      h === "arweave.news" ||
      h === "ar-io.dev" ||
      h === "arweave.cache.holaplex.com"
    )
      return true
    if (h.endsWith(".irys.xyz")) return true
    return false
  } catch (e) {
    return false
  }
}

function hexToUint8Array(hex) {
  var clean = hex.replace(/^0x/, "")
  if (clean.length % 2 !== 0) clean = "0" + clean
  var len = clean.length / 2
  var out = new Uint8Array(len)
  for (var i = 0; i < len; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16)
  }
  return out
}

function uint8ArrayToHex(arr) {
  var hex = ""
  for (var i = 0; i < arr.length; i++) {
    var h = arr[i].toString(16)
    if (h.length === 1) h = "0" + h
    hex += h
  }
  return "0x" + hex
}

function keccak256(dataHex) {
  var data = hexToUint8Array(dataHex)
  var keccakBits = 256
  var keccakBytes = keccakBits / 8
  var state = new Uint32Array(50)
  var blockSize = 200 - keccakBytes * 2
  var i
  for (i = 0; i + blockSize <= data.length; i += blockSize) {
    for (var j = 0; j < blockSize; j++) {
      state[j >> 2] ^= data[i + j] << ((j & 3) << 3)
    }
    keccakF(state)
  }
  var temp = new Uint8Array(blockSize)
  var tempLen = data.length - i
  for (var k = 0; k < tempLen; k++) {
    temp[k] = data[i + k]
  }
  temp[tempLen] = 0x01
  temp[blockSize - 1] |= 0x80
  for (var m = 0; m < blockSize; m++) {
    state[m >> 2] ^= temp[m] << ((m & 3) << 3)
  }
  keccakF(state)
  var out = new Uint8Array(keccakBytes)
  for (var n = 0; n < keccakBytes; n++) {
    out[n] = (state[n >> 2] >> ((n & 3) << 3)) & 0xff
  }
  return uint8ArrayToHex(out)
}

function keccakF(s) {
  var R = [
    1, 3, 6, 10, 15, 21, 28, 36, 45, 55,
    2, 14, 27, 41, 56, 8, 25, 43, 62, 18,
    39, 61, 20, 44, 63, 19, 42, 60, 23, 47,
    64, 30, 57, 17, 49, 12, 34, 59, 24, 53,
    11, 35, 52, 29, 50, 22, 46, 9
  ]
  var RC = [
    1, 0x8082, 0x800000000000808a, 0x8000000080008000,
    0x808b, 0x80000001, 0x8000000080008081, 0x8000000000008009,
    0x8a, 0x88, 0x80008009, 0x8000000a,
    0x8000808b, 0x800000000000008b, 0x8000000000008089, 0x8000000000008003,
    0x8000000000008002, 0x8000000000000080, 0x800a, 0x800000008000000a,
    0x8000000080008081, 0x8000000000008080, 0x80000001, 0x8000000080008008
  ]
  for (var round = 0; round < 24; round++) {
    var c0 = s[0] ^ s[10] ^ s[20] ^ s[30] ^ s[40]
    var c1 = s[1] ^ s[11] ^ s[21] ^ s[31] ^ s[41]
    var c2 = s[2] ^ s[12] ^ s[22] ^ s[32] ^ s[42]
    var c3 = s[3] ^ s[13] ^ s[23] ^ s[33] ^ s[43]
    var c4 = s[4] ^ s[14] ^ s[24] ^ s[34] ^ s[44]
    var d0 = c4 ^ ((c1 << 1) | (c1 >>> 31))
    var d1 = c0 ^ ((c2 << 1) | (c2 >>> 31))
    var d2 = c1 ^ ((c3 << 1) | (c3 >>> 31))
    var d3 = c2 ^ ((c4 << 1) | (c4 >>> 31))
    var d4 = c3 ^ ((c0 << 1) | (c0 >>> 31))
    for (var i0 = 0; i0 < 50; i0 += 5) {
      s[i0] ^= d0
      s[i0 + 1] ^= d1
      s[i0 + 2] ^= d2
      s[i0 + 3] ^= d3
      s[i0 + 4] ^= d4
    }
    var x
    var y
    var current = s[1]
    for (var i1 = 0; i1 < 24; i1++) {
      var j = R[i1]
      x = current
      y = s[j]
      s[j] = (x << ((j % 32)) | x >>> (32 - (j % 32)))
      current = y
    }
    for (var x0 = 0; x0 < 25; x0 += 5) {
      var a0 = s[x0]
      var a1 = s[x0 + 1]
      var a2 = s[x0 + 2]
      var a3 = s[x0 + 3]
      var a4 = s[x0 + 4]
      s[x0] = a0 ^ (~a1 & a2)
      s[x0 + 1] = a1 ^ (~a2 & a3)
      s[x0 + 2] = a2 ^ (~a3 & a4)
      s[x0 + 3] = a3 ^ (~a4 & a0)
      s[x0 + 4] = a4 ^ (~a0 & a1)
    }
    s[0] ^= RC[round] & 0xffffffff
  }
}

function utf8ToHex(str) {
  var encoder = new TextEncoder()
  var bytes = encoder.encode(str)
  var hex = ""
  for (var i = 0; i < bytes.length; i++) {
    var h = bytes[i].toString(16)
    if (h.length === 1) h = "0" + h
    hex += h
  }
  return "0x" + hex
}

function namehash(domain) {
  var node = "0x" + "00".repeat(32)
  if (domain) {
    var labels = domain.toLowerCase().split(".")
    for (var i = labels.length - 1; i >= 0; i--) {
      var labelHex = utf8ToHex(labels[i])
      var labelHash = keccak256(labelHex)
      var concat = node.replace(/^0x/, "") + labelHash.replace(/^0x/, "")
      node = keccak256("0x" + concat)
    }
  }
  return node
}

function pad32(hex) {
  var clean = hex.replace(/^0x/, "")
  while (clean.length < 64) clean = "0" + clean
  return clean
}

function encodeResolverOfCall(tokenIdHex) {
  var selector = keccak256(utf8ToHex("resolverOf(uint256)")).slice(2, 10)
  var arg = pad32(tokenIdHex)
  return "0x" + selector + arg
}

function encodeGetRecordCall(key, tokenIdHex) {
  var selector = keccak256(utf8ToHex("get(string,uint256)")).slice(2, 10)
  var keyHex = utf8ToHex(key).replace(/^0x/, "")
  var keyLen = Math.floor(keyHex.length / 2)
  var headLen = 64
  var offset = pad32("0x" + headLen.toString(16))
  var tokenPart = pad32(tokenIdHex)
  var lenPart = pad32("0x" + keyLen.toString(16))
  var paddedKeyHex = keyHex
  while (paddedKeyHex.length % 64 !== 0) paddedKeyHex += "0"
  var data = offset + tokenPart + lenPart + paddedKeyHex
  return "0x" + selector + data
}

function decodeAddressFromCall(resultHex) {
  var clean = resultHex.replace(/^0x/, "")
  if (clean.length < 64) return null
  var start = clean.length - 40
  if (start < 0) start = 0
  var addr = clean.slice(start)
  return "0x" + addr
}

function decodeStringFromCall(resultHex) {
  var clean = resultHex.replace(/^0x/, "")
  if (clean.length < 64) return ""
  var offsetHex = clean.slice(0, 64)
  var offset = parseInt(offsetHex, 16) * 2
  if (clean.length < offset + 64) return ""
  var lenHex = clean.slice(offset, offset + 64)
  var len = parseInt(lenHex, 16)
  var dataStart = offset + 64
  var dataHex = clean.slice(dataStart, dataStart + len * 2)
  var bytes = new Uint8Array(len)
  for (var i = 0; i < len; i++) {
    bytes[i] = parseInt(dataHex.slice(i * 2, i * 2 + 2), 16)
  }
  var decoder = new TextDecoder()
  return decoder.decode(bytes)
}

function jsonRpcCall(method, params) {
  return fetch(SONIC_RPC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: method,
      params: params
    })
  }).then(function (res) {
    if (!res.ok) throw new Error("RPC HTTP error " + res.status)
    return res.json()
  }).then(function (body) {
    if (body.error) throw new Error(body.error.message || "RPC error")
    return body.result
  })
}

function pingGateway(base, id, timeoutMs) {
  var controller = new AbortController()
  var signal = controller.signal
  var timer = setTimeout(function () {
    controller.abort()
  }, timeoutMs)
  return fetch(base + id, {
    method: "HEAD",
    signal: signal
  }).then(function (res) {
    clearTimeout(timer)
    if (!res.ok) throw new Error("Gateway HTTP error " + res.status)
    return base
  }).catch(function () {
    clearTimeout(timer)
    throw new Error("Gateway failed")
  })
}

function chooseGateway(id) {
  var gateways = ARWEAVE_GATEWAYS.slice()
  var timeoutMs = 1200
  var index = 0
  function tryNext() {
    if (index >= gateways.length) {
      return Promise.resolve(ARWEAVE_GATEWAYS[0])
    }
    var base = gateways[index]
    index += 1
    return pingGateway(base, id, timeoutMs).catch(function () {
      return tryNext()
    })
  }
  return tryNext()
}

function ensureGatewayUrl(value) {
  if (value.startsWith("http://") || value.startsWith("https://")) {
    if (!isAllowedUserNavigationUrl(value)) {
      return Promise.reject(new Error("Resolved URL host is not allowlisted for this extension."))
    }
    return Promise.resolve(value)
  }
  var id = value
  return chooseGateway(id).then(function (base) {
    return base + id
  })
}

function resolveDomainToUrl(domain) {
  var value = (domain || "").trim().toLowerCase()
  if (!value.endsWith(".sonic")) {
    return Promise.reject(new Error("Only .sonic domains are supported."))
  }
  var tokenId = namehash(value)
  var callDataResolver = encodeResolverOfCall(tokenId)
  return jsonRpcCall("eth_call", [{
    to: REGISTRY_ADDRESS,
    data: callDataResolver
  }, "latest"]).then(function (resolverResult) {
    if (!resolverResult || resolverResult === "0x") {
      throw new Error("Resolver not set for this domain.")
    }
    var resolverAddress = decodeAddressFromCall(resolverResult)
    if (!resolverAddress || /^0x0+$/.test(resolverAddress.toLowerCase().slice(2))) {
      throw new Error("Resolver not set for this domain.")
    }
    var callDataGet = encodeGetRecordCall(RECORD_KEY, tokenId)
    return jsonRpcCall("eth_call", [{
      to: resolverAddress,
      data: callDataGet
    }, "latest"])
  }).then(function (recordResult) {
    if (!recordResult || recordResult === "0x") {
      throw new Error("Record not set for this domain.")
    }
    var value = decodeStringFromCall(recordResult)
    if (!value) {
      throw new Error("Record empty for this domain.")
    }
    return ensureGatewayUrl(value)
  })
}

function openResolvedDomainFromOmnibox(domain) {
  resolveDomainToUrl(domain).then(function (url) {
    if (!isAllowedUserNavigationUrl(url)) {
      console.error("Sonic resolver: blocked non-allowlisted URL", url)
      return
    }
    chrome.tabs.create({ url: url })
  }).catch(function (err) {
    var d = (domain || "").trim().toLowerCase()
    if (d === "" || d === DEFAULT_DOMAIN) {
      var fallbackUrl = ARWEAVE_GATEWAYS[0] + DEFAULT_MANIFEST_ID
      if (!isAllowedUserNavigationUrl(fallbackUrl)) {
        console.error("Sonic resolver: invalid fallback URL")
        return
      }
      chrome.tabs.create({ url: fallbackUrl })
      return
    }
    console.error("Sonic resolver error:", err && err.message ? err.message : err)
  })
}

if (chrome && chrome.omnibox && chrome.omnibox.onInputEntered) {
  chrome.omnibox.onInputEntered.addListener(function (text) {
    var value = (text || "").trim().toLowerCase()
    if (value === "") {
      openResolvedDomainFromOmnibox(DEFAULT_DOMAIN)
      return
    }
    if (!value.endsWith(".sonic")) {
      value = value + ".sonic"
    }
    openResolvedDomainFromOmnibox(value)
  })
}

