// Reference tables: HTTP status codes (RFC 9110 and friends, the IANA
// registry) and MIME types by file extension (IANA media types, as browsers
// and common servers map them).

// [code, name, what it means, when you see or send it]
export const HTTP_STATUS = [
  [100, 'Continue', 'The headers were accepted; send the body.', 'Clients that sent Expect: 100-continue before a large upload'],
  [101, 'Switching Protocols', 'The server switches to the protocol asked for in Upgrade.', 'Opening a WebSocket'],
  [102, 'Processing', 'Still working (WebDAV); deprecated.', 'Long WebDAV operations'],
  [103, 'Early Hints', 'Headers (usually Link preloads) sent before the final response.', 'Letting the browser preload CSS and fonts while the page is generated'],
  [200, 'OK', 'The request worked; the body holds the result.', 'Any successful GET, or a POST that returns data'],
  [201, 'Created', 'A new resource was created; Location says where.', 'POST that creates a record'],
  [202, 'Accepted', 'Accepted for processing, not done yet.', 'Queued jobs and asynchronous APIs'],
  [203, 'Non-Authoritative Information', 'A proxy changed the response from the origin.', 'Transforming proxies'],
  [204, 'No Content', 'It worked and there is no body.', 'DELETE, or a PUT/PATCH that returns nothing'],
  [205, 'Reset Content', 'It worked; reset the form or view that sent it.', 'Rare: form submissions'],
  [206, 'Partial Content', 'Only the byte range asked for in Range.', 'Resumed downloads, video seeking'],
  [207, 'Multi-Status', 'Several results in one XML body (WebDAV).', 'WebDAV batch operations'],
  [208, 'Already Reported', 'Members already listed earlier in the response (WebDAV).', 'WebDAV bindings'],
  [226, 'IM Used', 'A delta of the resource, per A-IM.', 'Rare: delta encoding'],
  [300, 'Multiple Choices', 'Several representations; pick one.', 'Rare: content negotiation'],
  [301, 'Moved Permanently', 'The resource lives at Location from now on; clients may turn POST into GET.', 'Changed URLs, http to https, domain moves'],
  [302, 'Found', 'Temporarily at Location; clients usually follow with GET.', 'Redirect after login, temporary moves'],
  [303, 'See Other', 'Fetch the result from Location with GET.', 'Redirect after a POST (post/redirect/get)'],
  [304, 'Not Modified', 'The cached copy is still good; no body.', 'Conditional GET with If-None-Match or If-Modified-Since'],
  [305, 'Use Proxy', 'Deprecated; ignored by browsers.', 'Never'],
  [307, 'Temporary Redirect', 'Temporarily at Location; repeat with the same method and body.', 'Temporary moves where POST must stay POST'],
  [308, 'Permanent Redirect', 'Permanently at Location; same method and body.', 'Permanent API moves that keep POST'],
  [400, 'Bad Request', 'The request is malformed or invalid.', 'Bad JSON, missing fields, invalid parameters'],
  [401, 'Unauthorized', 'Not authenticated: credentials missing or wrong (WWW-Authenticate says how).', 'Missing or expired token'],
  [402, 'Payment Required', 'Reserved; some APIs use it for billing limits.', 'Quota or subscription exhausted'],
  [403, 'Forbidden', 'Authenticated (or not) but not allowed.', 'Lacking permission, blocked IP, CSRF failure'],
  [404, 'Not Found', 'Nothing here (or it is being hidden).', 'Wrong URL, deleted resource'],
  [405, 'Method Not Allowed', 'This URL does not take this method; Allow lists those it does.', 'POST to a read-only endpoint'],
  [406, 'Not Acceptable', 'No representation matches the Accept headers.', 'Asking for XML from a JSON-only API'],
  [407, 'Proxy Authentication Required', 'Like 401, for a proxy.', 'Corporate proxies'],
  [408, 'Request Timeout', 'The client took too long to send the request.', 'Idle connections, slow uploads'],
  [409, 'Conflict', 'Conflicts with the current state of the resource.', 'Edit conflicts, duplicates, version mismatch'],
  [410, 'Gone', 'Removed for good, with no forwarding address.', 'Retired APIs and deleted content'],
  [411, 'Length Required', 'Send a Content-Length.', 'Servers that refuse chunked uploads'],
  [412, 'Precondition Failed', 'An If-Match / If-Unmodified-Since condition failed.', 'Optimistic concurrency with ETags'],
  [413, 'Content Too Large', 'The body is bigger than the server accepts.', 'Uploads over the size limit'],
  [414, 'URI Too Long', 'The URL is longer than the server accepts.', 'Huge query strings'],
  [415, 'Unsupported Media Type', 'The body format (Content-Type) is not accepted.', 'Sending form data to a JSON API'],
  [416, 'Range Not Satisfiable', 'The Range asked for is outside the resource.', 'Resuming past the end of a file'],
  [417, 'Expectation Failed', 'The Expect header cannot be met.', 'Rare: Expect: 100-continue refused'],
  [418, "I'm a teapot", 'An April Fools joke (RFC 2324), reserved.', 'Easter eggs'],
  [421, 'Misdirected Request', 'This server cannot answer for that host (connection reuse).', 'HTTP/2 connection coalescing gone wrong'],
  [422, 'Unprocessable Content', 'Well-formed but semantically invalid.', 'Validation errors in APIs'],
  [423, 'Locked', 'The resource is locked (WebDAV).', 'WebDAV locks'],
  [424, 'Failed Dependency', 'Failed because an earlier request failed (WebDAV).', 'WebDAV batches'],
  [425, 'Too Early', 'Not willing to risk a replayed early-data request.', 'TLS 1.3 0-RTT'],
  [426, 'Upgrade Required', 'Switch protocol (Upgrade says which).', 'Forcing TLS or a newer HTTP version'],
  [428, 'Precondition Required', 'This needs a conditional request (If-Match).', 'APIs that forbid blind overwrites'],
  [429, 'Too Many Requests', 'Rate limited; Retry-After says when to try again.', 'API rate limits, login throttling'],
  [431, 'Request Header Fields Too Large', 'Headers (often cookies) are too big.', 'Bloated cookies'],
  [451, 'Unavailable For Legal Reasons', 'Blocked for legal reasons.', 'Court orders, regional restrictions'],
  [500, 'Internal Server Error', 'The server failed unexpectedly.', 'Unhandled exceptions'],
  [501, 'Not Implemented', 'The server does not support this functionality.', 'Unknown methods'],
  [502, 'Bad Gateway', 'A proxy or gateway got an invalid answer from upstream.', 'The app behind the proxy crashed or is down'],
  [503, 'Service Unavailable', 'Temporarily unable (overloaded or maintenance); Retry-After may say when.', 'Maintenance, overload, deploys'],
  [504, 'Gateway Timeout', 'A proxy or gateway did not hear back from upstream in time.', 'Slow backends behind a load balancer'],
  [505, 'HTTP Version Not Supported', 'The HTTP version is not supported.', 'Rare'],
  [506, 'Variant Also Negotiates', 'Content negotiation misconfigured.', 'Rare'],
  [507, 'Insufficient Storage', 'Not enough storage to complete (WebDAV).', 'Full disks on WebDAV servers'],
  [508, 'Loop Detected', 'An infinite loop while processing (WebDAV).', 'WebDAV bindings'],
  [510, 'Not Extended', 'Further extensions required; obsolete.', 'Rare'],
  [511, 'Network Authentication Required', 'Log in to the network first.', 'Captive portals (hotel and café Wi-Fi)'],
];

export const STATUS_CLASS = { 1: 'Informational', 2: 'Success', 3: 'Redirection', 4: 'Client error', 5: 'Server error' };

// '404', '4xx', '40x', 'not found', 'redirect' -> matching rows
export function findStatus(query) {
  const q = String(query).trim().toLowerCase();
  if (!q) return HTTP_STATUS;
  const pattern = /^[1-5][0-9x]{2}$/.exec(q);
  if (pattern) {
    const re = new RegExp('^' + q.replace(/x/g, '\\d') + '$');
    return HTTP_STATUS.filter(([c]) => re.test(String(c)));
  }
  const words = q.split(/\s+/);
  return HTTP_STATUS.filter((r) => {
    const text = (r.join(' ') + ' ' + STATUS_CLASS[String(r[0])[0]]).toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

// ---- MIME types ------------------------------------------------------------------------

// extension -> type (the usual one first when several types share an extension).
export const MIME = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript',
  json: 'application/json', jsonld: 'application/ld+json', map: 'application/json', webmanifest: 'application/manifest+json',
  xml: 'application/xml', xhtml: 'application/xhtml+xml', rss: 'application/rss+xml', atom: 'application/atom+xml', xsl: 'application/xslt+xml',
  txt: 'text/plain', text: 'text/plain', log: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', csv: 'text/csv', tsv: 'text/tab-separated-values',
  ics: 'text/calendar', vcf: 'text/vcard', rtf: 'application/rtf', yaml: 'application/yaml', yml: 'application/yaml', toml: 'application/toml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  svg: 'image/svg+xml', svgz: 'image/svg+xml', ico: 'image/vnd.microsoft.icon', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  heic: 'image/heic', heif: 'image/heif', jxl: 'image/jxl', apng: 'image/apng', psd: 'image/vnd.adobe.photoshop',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/opus', flac: 'audio/flac', aac: 'audio/aac',
  m4a: 'audio/mp4', weba: 'audio/webm', mid: 'audio/midi', midi: 'audio/midi',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime', avi: 'video/x-msvideo',
  mkv: 'video/x-matroska', mpeg: 'video/mpeg', mpg: 'video/mpeg', ts: 'video/mp2t', m3u8: 'application/vnd.apple.mpegurl', mpd: 'application/dash+xml',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
  pdf: 'application/pdf', zip: 'application/zip', gz: 'application/gzip', tgz: 'application/gzip', tar: 'application/x-tar',
  bz2: 'application/x-bzip2', xz: 'application/x-xz', '7z': 'application/x-7z-compressed', rar: 'application/vnd.rar', zst: 'application/zstd',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', odp: 'application/vnd.oasis.opendocument.presentation',
  epub: 'application/epub+zip', wasm: 'application/wasm', bin: 'application/octet-stream', exe: 'application/vnd.microsoft.portable-executable',
  dmg: 'application/x-apple-diskimage', deb: 'application/vnd.debian.binary-package', rpm: 'application/x-rpm', apk: 'application/vnd.android.package-archive',
  jar: 'application/java-archive', swf: 'application/x-shockwave-flash', sh: 'application/x-sh', php: 'application/x-httpd-php',
  py: 'text/x-python', java: 'text/x-java-source', c: 'text/x-c', cpp: 'text/x-c++', go: 'text/x-go', rs: 'text/rust', rb: 'text/x-ruby',
  sql: 'application/sql', graphql: 'application/graphql', proto: 'text/plain',
  pem: 'application/x-pem-file', crt: 'application/x-x509-ca-cert', cer: 'application/pkix-cert', der: 'application/x-x509-ca-cert',
  p12: 'application/x-pkcs12', pfx: 'application/x-pkcs12', csr: 'application/pkcs10', key: 'application/x-pem-file',
  gpx: 'application/gpx+xml', kml: 'application/vnd.google-earth.kml+xml', geojson: 'application/geo+json',
  eml: 'message/rfc822', mbox: 'application/mbox', torrent: 'application/x-bittorrent', ps: 'application/postscript', ai: 'application/postscript',
};

// '.png', 'png', 'photo.jpg' -> { ext, type } | 'image/png', 'image/*', 'json' (part of a type) -> types with their extensions.
export function findMime(query) {
  const q = String(query).trim().toLowerCase();
  if (!q) return [];
  const ext = q.replace(/^.*\./, '');
  if (!q.includes('/') && MIME[ext]) return [{ ext, type: MIME[ext], by: 'extension' }];
  const byType = new Map();
  for (const [e, t] of Object.entries(MIME)) {
    const hit = q.includes('/') ? (q.endsWith('/*') ? t.startsWith(q.slice(0, -1)) : t === q) : t.includes(q);
    if (hit) byType.set(t, [...(byType.get(t) || []), e]);
  }
  return [...byType].map(([type, exts]) => ({ type, exts, by: 'type' }));
}
