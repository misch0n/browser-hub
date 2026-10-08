# Commands

Every built-in command, by the group `help` shows it in. Generated from the
definitions in `js/commands/` by `node tools/docs-commands.mjs --write`; a unit
test fails when this file is out of date, so don't edit it by hand.

Flags: **private** stays out of the shared (synced) history; **no ↑ history**
isn't kept for ↑ recall either; **for now** is shown, then removed when the next
command runs; **no undo** is never an undo step.

## Find

### `find`

search everything: tasks, notes, events, snippets, links, diagrams, aliases, commands, history

```
find <words>
find "<phrase>"
find /<regex>/[flags]
find <words> in:<category>
```

Examples: `find flour` · `find pmt` · `find "oat milk"` · `find /^buy\s/` · `find standup in:events` · `find #home`

## Notes

### `notes`

list, add, show, edit and remove notes

```
notes [filter]
notes add <text>
notes <id>
notes <id> edit [<field> [<value>]]
notes <id> rm
```

Examples: `notes` · `notes plumber` · `notes add call the plumber` · `notes n3` · `notes n3 edit` · `notes n3 edit text call the plumber today` · `notes n3 rm`

### `n`

short for notes; n <text> adds a note

```
n <text>
n "<text that starts like a command>"
n <id> [edit [<field> [<value>]] | rm]
```

Examples: `n call the plumber about the boiler` · `n "rm the weeds"` · `n n3 edit text call the plumber today`

## Tasks

### `tasks`

list, add, show, edit, complete and remove tasks

```
tasks [all] [#tag]
tasks add <text> [due:<date>] [every:<rule>] [#tag]
tasks <id>
tasks <id> edit [<field> [<value>]]
tasks <id> done
tasks <id> rm
```

Examples: `tasks` · `tasks #home` · `tasks add buy flour due:tomorrow #home` · `tasks add water the plants every:mon,thu` · `tasks t3` · `tasks t3 edit` · `tasks t3 edit due fri` · `tasks t3 edit name buy rye flour` · `tasks t3 edit repeat none` · `tasks t3 done` · `tasks t3 rm`

### `t`

short for tasks; t <text> adds a task

```
t <text> [due:<date>] [every:<rule>] [#tag]
t "<text that starts like a command>"
t <id> [edit [<field> [<value>]] | done | rm]
```

Examples: `t buy flour due:tomorrow #home` · `t pay rent every:month due:2026-11-01` · `t "done: write the report"` · `t t3 done` · `t t3 edit due fri`

## Calendar

### `cal`

month grid with event days marked

```
cal [month [year]]
cal [YYYY-MM]
cal next|last
```

Examples: `cal` · `cal dec` · `cal march 2027` · `cal 2026-12` · `cal next`

### `agenda`

events and due tasks for the next n days (default 7)

```
agenda [n]
```

Examples: `agenda` · `agenda 30`

### `today`

the daily summary; pinned at the top until dismissed for the day

```
today
today dismiss
today pin
today off
today on
```

Examples: `today` · `today dismiss` · `today off`

### `events`

list, add, show, edit and remove events

```
events [all]
events add <date> [HH:MM] <title>
events <id>
events <id> edit [<field> [<value>]]
events <id> rm
```

Examples: `events` · `events all` · `events add fri 19:30 dinner at Mia's` · `events e2` · `events e2 edit` · `events e2 edit time 20:00` · `events e2 rm`

### `ev`

short for events; ev <date> … adds an event

```
ev <date> [HH:MM] <title>
ev <id> [edit [<field> [<value>]] | rm]
```

Examples: `ev fri 19:30 dinner at Mia's` · `ev 2026-12-24 Christmas Eve` · `ev e2 edit time 20:00` · `ev e2 rm`

## Snippets

### `snippets`

named pieces of text to copy again: list, add, show, edit, remove

```
snippets [filter]
snippets add <name> <text>
snippets <id | name>
snippets <id | name> edit [<field> [<value>]]
snippets <id | name> rm
```

Examples: `snippets` · `snippets add sig Best regards, Mihail` · `snippets sig` · `snippets s2 edit text Cheers, M` · `snippets s2 rm`

### `snip`

short for snippets: snip <name> shows one to copy, snip <name> <text> adds one

```
snip <name>
snip <name> <text>
snip <name> [edit [<field> [<value>]] | rm]
```

Examples: `snip addr 1 Long Street, Sofia` · `snip addr` · `snip addr edit text 2 Long Street, Sofia`

## Read later

### `later`

links to read later: later <url> saves one, later lists them

```
later <url> [title]
later [all | filter]
later add <url> [title]
later <id>
later <id> edit [<field> [<value>]]
later <id> open
later <id> done
later <id> rm
```

Examples: `later https://example.com/long-read A long read` · `later` · `later l2 open` · `later l2 done` · `later all`

## Diagrams

### `diagrams`

Mermaid diagrams you keep: list, add, see, edit live, rename, export

```
diagrams [filter]
diagrams add <name> [code]
diagrams <id>
diagrams <id> edit [<field> [<value>]]
diagrams <id> save
diagrams <id> code
diagrams <id> rm
diagrams export
diagrams import
```

Examples: `diagrams` · `diagrams add flow <paste Mermaid code>` · `diagrams add flow   (keeps what the editor holds)` · `diagrams d1` · `diagrams d1 edit` · `diagrams d1 edit name Sign-up flow` · `diagrams d1 save` · `diagrams export` · `diagrams import`

### `mermaid`

draw a Mermaid diagram: the live editor, or a picture of pasted code

```
mermaid
mermaid <code>
```

Examples: `mermaid` · `mermaid <paste Mermaid code>` · `mermaid graph LR; a-->b`

## Dates

### `date`

a day in detail, date ± days/weeks/months, or the days between two dates

```
date [<date>]
date [<date>] ± <n> d|w|m|y|wd
date <date> to <date>
```

Examples: `date` · `date 25 dec` · `date + 90d` · `date fri + 3 wd` · `date 31 jan + 1m` · `date 1 jan to 25 dec` · `date 2026-10-05 - 2026-01-01`

### `days`

days until or since a date, or between two

```
days until <date>
days since <date>
days <date> to <date>
```

Examples: `days until 25 dec` · `days since 1 jan` · `days since last fri` · `days 1 mar to 1 jun`

### `week`

the week number and its days: this week, week <n>, or the week of a date

```
week
week <n> [year]
week <date>
```

Examples: `week` · `week 52` · `week 1 2027` · `week 25 dec`

## Tools

### `calc`

arithmetic with ^ % ( ), sqrt, round, sin, ln, pi …

```
calc <expr>
```

Examples: `calc (1200 * 1.2) / 12` · `calc sqrt(2)^2` · `calc 2^10 - 1`

### `epoch`

unix time now, or convert to and from a date

```
epoch [timestamp | date]
epoch 2026-10-05 09:00[:SS][Z]
```

Examples: `epoch` · `epoch 1700000000` · `epoch 2026-10-05 09:00`

### `uuid`

generate a v4 UUID

```
uuid
```

### `b64`

base64 encode or decode (UTF-8)

```
b64 encode <text>
b64 decode <text>
```

### `json`

validate and pretty-print JSON, in colour, as a tree, or minified

```
json <text>
json tree <text>
json min <text>
```

Examples: `json {"a":1,"b":[true,null,"x"]}` · `json tree <paste>` · `json min <paste>`

### `units`

convert length, mass, volume, temperature, data …

```
units <value> <from> to <to>
```

Examples: `units 5 km to mi` · `units 350 f to c` · `units 2 gib to mb`

### `qr`

a QR code for text or a link, to scan with a phone

```
qr <text>
```

Examples: `qr https://misch0n.github.io/browser-hub/` · `qr call me back on 0123 456`

### `barcode`

a barcode: Code 128, Code 39, EAN-13/8, UPC-A, ITF, Codabar (or QR), to save as SVG or PNG

```
barcode <text>
barcode code128|code39|ean13|ean8|upca|itf|codabar|qr <text>
barcode <type> [height <px>] [scale <px per bar>] [margin <bars>] [notext] [check] <text>
```

Examples: `barcode HELLO-123` · `barcode ean13 590123412345` · `barcode upca 03600029145` · `barcode code39 check WIDGET-7` · `barcode itf height 100 scale 3 1234567890` · `barcode codabar A40156B` · `barcode notext code128 order 1182`

### `zones`

your time zones: list, add, name and remove them

```
zones [all [filter]]
zones add <zone> [name]
zones <zone>
zones <zone> edit [<field> [<value>]]
zones <zone> rm
```

Examples: `zones` · `zones all europe` · `zones add tokyo Kenji` · `zones add America/New_York` · `zones tokyo` · `zones tokyo edit` · `zones tokyo edit name Kenji's team` · `zones tokyo rm`

### `tz`

the time across your zones, now or at a given time, with working-hours overlap

```
tz
tz <HH:MM>
tz <HH:MM> <zone>
```

Examples: `tz` · `tz 15:00` · `tz 15:00 tokyo` · `tz 9:30 NYC office`

## Security

### `pw`

a random password, passphrase or PIN, made on this device *(private, no undo)*

```
pw [length]
pw words [count]
pw pin [digits]
pw simple [length]
```

Examples: `pw` · `pw 32` · `pw words` · `pw words 8` · `pw pin` · `pw simple 16`

### `hash`

MD5 and SHA checksums of text *(private)*

```
hash <text>
hash md5|sha1|sha256|sha384|sha512 <text>
```

Examples: `hash hello` · `hash sha256 hello`

### `jwt`

decode a JSON Web Token, check its signature, or sign one (HS, RS, PS, ES, EdDSA) *(private, no ↑ history)*

```
jwt <token>
jwt <token> <key>
jwt verify <token> [key]
jwt sign <alg> <payload JSON> [key]
```

Examples: `jwt eyJhbGciOi…` · `jwt verify eyJhbGciOi…   (HS: asks for the secret, hidden)` · `jwt verify eyJhbGciOi… <paste a PEM or JWK public key>` · `jwt sign HS256 {"sub":"me"}` · `jwt sign ES256 {"sub":"me"} <paste a PKCS#8 private key>`

### `hmac`

HMAC of a message with a key (text, hex: or base64:), SHA-1/256/384/512 *(private, no ↑ history)*

```
hmac [sha1|sha256|sha384|sha512] <key> <message>
```

Examples: `hmac sha256 secret hello world` · `hmac sha512 hex:0b0b0b0b "Hi There"` · `hmac "my key" message`

### `crypt`

encrypt and decrypt with AES (passphrase or key) or RSA; make keys; PEM ⇄ JWK *(private, no ↑ history)*

```
crypt encrypt [gcm|cbc] <text>
crypt decrypt <ccx1 envelope>
crypt decrypt gcm|cbc <iv> <ciphertext>
crypt encrypt rsa <public key> <text>
crypt decrypt rsa <private key> <ciphertext>
crypt keygen aes [128|192|256]
crypt keygen rsa [2048|3072|4096]
crypt keygen ec [P-256|P-384|P-521]
crypt keygen ed25519
crypt key <PEM or JWK>
```

Examples: `crypt encrypt meet at noon   (asks for a passphrase, hidden)` · `crypt decrypt ccx1.gcm.210000.…` · `crypt keygen aes` · `crypt encrypt rsa <paste a public key> hello` · `crypt decrypt rsa <paste the private key> <base64>` · `crypt keygen rsa 3072` · `crypt key <paste a PEM key>`

### `cert`

decode an X.509 certificate or request: names, dates, SANs, key, fingerprints

```
cert <PEM certificate(s)>
cert <PEM certificate request>
cert <base64 or hex DER>
```

Examples: `cert <paste -----BEGIN CERTIFICATE-----…>` · `cert <paste a whole chain>` · `cert <paste -----BEGIN CERTIFICATE REQUEST-----…>`

## Text

### `count`

characters, words, lines and reading time of some text

```
count <text>
```

Examples: `count paste a long text after count`

### `case`

change case: camelCase, snake_case, kebab-case, Title Case …

```
case <text>
case camel|pascal|snake|kebab|constant|title|sentence|lower|upper|dot <text>
```

Examples: `case user account id` · `case snake parseHTTPResponse` · `case title the quick brown fox`

### `text`

line tools: dedupe, sort, trim, find and replace, counts, case, lorem ipsum

```
text dedupe <text>
text sort [desc] [numeric] [unique] <text>
text reverse <text>
text trim <text>
text replace <find> <with> <text>
text count <text>
text upper|lower|title <text>
text number <text>
text lorem [n] [words|sentences|paragraphs]
```

Examples: `text dedupe <paste>` · `text sort numeric desc <paste>` · `text replace "foo" "bar" <paste>` · `text replace /(\d+)px/g $1rem <paste>` · `text lorem 3` · `text lorem 50 words`

## Developer

### `cidr`

an IP range or address: network, mask, first and last, size, kind

```
cidr <address>/<prefix>
cidr <address>
cidr <range> <address>
```

Examples: `cidr 10.0.1.5/22` · `cidr 192.168.1.10` · `cidr 2001:db8::/48` · `cidr 10.0.0.0/22 10.0.3.9`

### `url`

take a URL apart, or percent-encode and decode text

```
url <url>
url encode <text>
url decode <text>
```

Examples: `url https://example.com:8080/a/b?q=hello%20world&x=1#top` · `url encode a&b=c d` · `url decode a%26b%3Dc%20d`

### `regex`

try a regular expression on some text: every match and its groups

```
regex /pattern/flags <text>
```

Examples: `regex /(\d{3})-(\d{4})/ call 555-1234 or 555-9876` · `regex /^(?<user>[^@]+)@(?<domain>.+)$/ me@example.com`

### `diff`

compare two texts: paste them both after diff, or quote them

```
diff <paste> <paste>
diff "<text>" "<text>"
```

Examples: `diff "the quick brown fox" "the quick red fox"`

### `cron`

a cron schedule in words, and when it runs next

```
cron <minute> <hour> <day> <month> <weekday>
cron @daily|@hourly|@weekly|@monthly|@yearly
```

Examples: `cron */15 * * * *` · `cron 30 9 * * 1-5` · `cron 0 0 1 * *`

### `color`

convert a colour (hex, rgb, hsl) and check contrast

```
color <colour>
color <text colour> on <background>
```

Examples: `color #0af` · `color hsl(200, 100%, 50%)` · `color #777 on #fff`

### `csv`

view CSV (or tab, semicolon, pipe separated) as a table to sort and filter

```
csv <paste>
csv comma|semicolon|tab|pipe <paste>
csv noheader <paste>
csv json <paste>
```

Examples: `csv <paste a spreadsheet export>` · `csv semicolon <paste>` · `csv json <paste>`

### `base`

numbers in binary, octal, decimal, hex or any base 2–36, any size, with bit-width views

```
base <number>
base <number> from <base>
base <number> to <base>
base <number> bits 8|16|32|64
```

Examples: `base 255` · `base 0xff` · `base 0b1010` · `base zz from 36` · `base 1000 to 7` · `base -1 bits 16` · `base 123456789012345678901234567890`

### `escape`

a regex or a string, written correctly for JS, Python, Java, C#, Go, PHP, Ruby, Rust, JSON

```
escape <text>
escape /<regex>/<flags>
```

Examples: `escape C:\Users\me "quoted"` · `escape /^\d{3}-\d{4}$/i` · `escape /https?:\/\/\S+/g`

## Share

### `clip`

share one piece of text with your other devices, for 15 minutes, encrypted *(private, no ↑ history, no undo)*

```
clip
clip <text>
clip add <text>
clip clear
clip key
clip key off
```

Examples: `clip https://example.com/a/long/link` · `clip` · `clip clear` · `clip key`

### `bounce`

a link to this page that bounces to another address (the address travels inside it)

```
bounce <url>
bounce <bounce link>
```

Examples: `bounce https://example.com/a/rather/long/path?with=query` · `bounce https://misch0n.github.io/browser-hub/?go=…`

## Kitchen

### `cook`

kitchen reference: safe and best temperatures, oven times, cups and spoons to grams, calories and nutrients

```
cook target [food]
cook oven [food] [weight] [temperature] [fan] [doneness]
cook convert <amount> <measure> <ingredient>
cook convert <temperature>
cook calorie [amount] <food> [raw | cooked]
cook calorie <amount> <food> + <amount> <food> …
cook calorie add <name> <n> kcal <n> protein <n> fat <n> carbs [per …]
cook calorie f<n> [edit [<field> [<value>]] | rm]
cook calorie mine
```

Examples: `cook target chicken` · `cook target` · `cook oven chicken 500g at 200` · `cook oven whole chicken 1.6kg` · `cook oven beef 1.5kg medium-rare` · `cook oven lamb leg 2kg fan 160` · `cook calorie chicken` · `cook calorie chicken breast raw 250g` · `cook calorie 2 eggs` · `cook calorie 1 slice bread` · `cook calorie 200g chicken breast raw + 150g rice cooked + 1 tbsp olive oil` · `cook calorie add lyutenitsa 75 kcal 1.5 protein 2.5 fat 11 carbs` · `cook calorie crisps` · `cook convert 1 spoon sugar` · `cook convert ½ stick butter` · `cook convert 250 g flour` · `cook convert 350f`

## Chance

### `random`

random numbers: a band, a length, several, unique *(no undo)*

```
random
random <max>
random <min>-<max>
random <n> digits
random … x<count> [unique]
```

Examples: `random` · `random 50` · `random 10-20` · `random -5..5` · `random 0.5-2.5` · `random 6 digits` · `random 1-49 x6 unique` · `random 4 digits x3`

### `roll`

roll dice: every standard die, or d20, 2d6+3, 4d6kh3, d20 adv, stats *(no undo)*

```
roll
roll d<sides>
roll <n>d<sides>[+<n>d<sides>][±<modifier>]
roll d20 adv | dis
roll <n>d<sides>kh<k> | kl<k> | dl<k>
roll stats
```

Examples: `roll` · `roll d6` · `roll d20` · `roll 2d6+3` · `roll d20+5 adv` · `roll 8d6` · `roll 4d6kh3` · `roll d%` · `roll stats`

## Web

### `http`

HTTP status codes: what each means and when it is used

```
http
http <code>
http 4xx
http <words>
```

Examples: `http 404` · `http 3xx` · `http rate limit` · `http teapot`

### `mime`

MIME types: from a file extension to its type, or a type to its extensions

```
mime <extension | file name>
mime <type>
mime image/*
mime <part of a type>
```

Examples: `mime png` · `mime report.docx` · `mime application/json` · `mime video/*` · `mime xml`

### `ua`

read a user-agent string: browser, engine, system, device (yours by default)

```
ua
ua <user-agent string>
```

Examples: `ua` · `ua Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 … Version/17.6 Mobile/15E148 Safari/604.1` · `ua curl/8.4.0`

### `device`

this browser and device: screen, window, input, language, hardware, network, features

```
device
device features
```

Examples: `device` · `device features`

## Network

### `request`

test a URL, host or port from this browser: status, timing, headers, body

```
request <url | host[:port][/path]>
request [GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS] <target>
request <host> port <n> path <p> scheme http|https
request <target> timeout <seconds>
request <target> header "Name: value"
request POST <target> body <text>
```

Examples: `request example.com` · `request https://api.github.com/zen` · `request HEAD 1.1.1.1` · `request localhost:3000/health` · `request POST https://httpbin.org/post body {"a":1}` · `request example.com port 8443 timeout 3`

### `ping`

is a host up? a few HTTP(S) requests and their times (a browser can’t send ICMP)

```
ping <host | url>
ping <host> count <n>
```

Examples: `ping example.com` · `ping 1.1.1.1 count 8` · `ping localhost:8000`

### `dns`

look up DNS records over HTTPS (Cloudflare or Google): A, AAAA, MX, TXT, CNAME, NS…

```
dns <domain>
dns <domain> <type> [type…]
dns <IP address>
dns <domain> via google
```

Examples: `dns example.com` · `dns gmail.com mx` · `dns _dmarc.github.com txt` · `dns 1.1.1.1` · `dns example.com aaaa via google`

### `ip`

your public IP address (ipify), and where an address is and whose network (ipapi.co) *(private)*

```
ip
ip more
ip <address>
```

Examples: `ip` · `ip more` · `ip 1.1.1.1` · `ip 2606:4700:4700::1111`

## Aliases & engines

### `aliases`

list, add, show, edit and remove your aliases, search engines and command aliases

```
aliases [filter]
aliases add <name> <url> [template] [--path] [--force] | <name> <command>
aliases <name>
aliases <name> edit [<field> [<value>]]
aliases <name> default
aliases <name> rm
```

Examples: `aliases` · `aliases add gh https://github.com/ https://github.com/{} --path` · `aliases add yt https://www.youtube.com/results?search_query={}` · `aliases add jira https://jira.example.com/browse/{1}-{2}` · `aliases add bug https://jira.example.com/issues/?jql=project="APP" AND text ~ "%s"` · `aliases add groc tasks add {} #groceries` · `aliases add tt tasks` · `aliases add rename zones {1} edit name {2}` · `aliases gh` · `aliases gh edit` · `aliases gh edit template https://github.com/search?q={}` · `aliases groc edit command tasks add {} #shop` · `aliases ddg default` · `aliases gh rm`

### `alias`

short for aliases; alias <name> <url or command> adds one

```
alias <name> <url>
alias <name> <url with {} or %s> [--path]
alias <name> <base> <template> [--path] [--force]
alias <name> <command> [{} | {1} {2} …] [--force]
alias <name> [edit [<field> [<value>]] | default | rm]
```

Examples: `alias gh https://github.com/ https://github.com/{} --path` · `alias w https://en.wikipedia.org/w/index.php?search=%s` · `alias gh edit template https://github.com/{}` · `alias groc tasks add {} #groceries` · `alias tt tasks`

### `engine`

show or set the default search engine

```
engine
engine <name>
```

Examples: `engine` · `engine ddg`

### `go`

open a web address, as an alias would (example.com is enough)

```
go <url>
```

Examples: `go example.com` · `go github.com/misch0n/browser-hub/actions` · `go https://developer.mozilla.org/en-US/` · `go localhost:8000`

## View

### `theme`

list colour themes, or switch theme

```
theme [name]
```

Examples: `theme` · `theme nord` · `theme auto`

### `widgets`

the side panel: list, turn on and off, and order widgets

```
widgets
widgets add <name>
widgets <name>
widgets <name> edit [<field> [<value>]]
widgets <name> on
widgets <name> off
widgets <name> move top|up|down|bottom|<n>
widgets <name> rm
widgets show|hide
widgets order <name> [name …]
```

Examples: `widgets` · `widgets add zones` · `widgets zones` · `widgets zones move top` · `widgets tasks move 2` · `widgets clock off` · `widgets zones edit position 1` · `widgets order zones clock agenda` · `widgets hide`

### `font`

make the text bigger or smaller on this device *(no undo)*

```
font
font bigger | smaller
font <percent>
font reset
```

Examples: `font bigger` · `font smaller` · `font 120%` · `font reset`

### `graph`

graph mode (experimental): every next step of a command shown as you type it *(no undo)*

```
graph <command …>
graph :sort [freq | alpha]
```

Examples: `graph cook convert 2 cups flour` · `graph :sort alpha`

## Sync

### `sync`

sync with a private GitHub repository; the token stays on this device *(private, no undo)*

```
sync
sync setup <owner/repo> [directory]
sync now
sync token
sync off
```

Examples: `sync setup me/private-data` · `sync setup me/private-data apps/hub` · `sync now` · `sync token`

## Meta

### `config`

your name and this device's name

```
config
config edit
config edit <field> <value>
```

Examples: `config` · `config edit name Michael` · `config edit device Work laptop` · `config edit name none`

### `help`

list commands, or everything about one *(for now)*

```
help [command]
```

### `keys`

keyboard shortcuts, labelled for this computer *(for now)*

```
keys
```

### `undo`

undo the last change (again for the one before) *(no undo)*

```
undo
undo list
undo force
```

Examples: `undo` · `undo list`

### `redo`

redo what undo took back *(no undo)*

```
redo
redo list
redo force
```

Examples: `redo`

### `clear`

clear the history: this device's session, or every device's

```
clear
clear current
clear all
```

Examples: `clear` · `clear all` · `undo`

### `session`

the shared history by device: list sessions, or choose which to show *(no undo)*

```
session
session show all
session show current
session show <device>
```

Examples: `session` · `session show current` · `session show all` · `session show iPhone · Safari`

### `history`

show recent commands

```
history [n]
```

### `export`

download all data as one JSON file

```
export
```

### `import`

load a file: an export, an xsearch export, or calendar events (.ics)

```
import
```
