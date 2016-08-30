// declare global: os, navigator

const mac = typeof navigator != "undefined" ? /Mac/.test(navigator.platform)
          : typeof os != "undefined" ? os.platform() == "darwin" : false
exports.mac = mac

const ios = typeof navigator != "undefined" && /AppleWebKit/.test(navigator.userAgent) && /Mobile\/\w+/.test(navigator.userAgent)
exports.ios = ios
