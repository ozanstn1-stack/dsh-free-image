# dsh-free-image

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) için
anahtarsız görsel üretimi.

`dsh-free-image`, DSH ajanına **API anahtarı ve ücretli hesap gerektirmeyen** bir
`generate_image` aracı verir. Sağlayıcı, prompt için görsel baytları döndüren bir
HTTP GET uç noktasından ibarettir; yani eklenti ücretsiz genel bir uç noktayla
kutudan çıktığı gibi çalışır, ayarı değiştirerek kendi sunucuna yönlendirebilirsin.

Ücretsiz uç noktalar IP başına hız sınırlıdır. Bu yüzden eklenti aynı anda tek
istek çalıştırır, uç noktanın "N saniye sonra tekrar dene" cevabını sınırlı bir
bütçe içinde bekler ve körlemesine hata vermek yerine kalan bekleme süresini
söyler.

## Araçlar

| Araç | Tür | Ne yapar |
| --- | --- | --- |
| `generate_image` | tek dosya yazar | Prompt'tan tek görsel üretir, ayarlı dizine kaydeder; mutlak yolu, gerçek piksel boyutunu ve bayt boyutunu döner. |
| `list_image_models` | salt-okunur | Ayarlı sağlayıcıları listeler: uç nokta, model, boyut sınırları, hız, zaman aşımı, çıktı dizini. |

## Nasıl çalışır

```
prompt ──▶ GET <baseUrl>/<url-encoded prompt>?width=…&height=…&nologo=true
         ◀── görsel baytları
            <output.dir>/<YYYYMMDD-HHMMSS>-<slug>.<ext> olarak kaydedilir
```

- Hiçbir anahtar saklanmaz/gönderilmez; istekte yalnızca prompt ve boyut vardır.
- Yanıt `image/*` olarak doğrulanmadan hiçbir şey yazılmaz.
- `output.maxBytes` üstündeki görseller yazılmaz, reddedilir.
- `402`/`429`/`503` cevabı, istediği bekleme `retry.budgetMs` içindeyse tekrar denenir;
  sığmıyorsa araç bekleme süresini raporlar.

## Kurulum

```bash
dsh plugin --profile web add dsh-free-image
systemctl restart dsh-web   # veya DSH sürecinizi yeniden başlatın
```

Ayar gerekmez: varsayılan sağlayıcı anahtarsız genel uç noktadır. Uç noktayı,
boyut sınırlarını veya çıktı dizinini değiştirmek için:

```yaml
- id: free-image
  config:
    providers:
      - id: pollinations
        label: Pollinations (keyless)
        baseUrl: https://image.pollinations.ai/prompt
        model: ''
        maxWidth: 1024
        maxHeight: 1024
        rateLimitMs: 45000
        timeoutMs: 120000
    defaults:
      provider: pollinations
      width: 512
      height: 512
    output:
      dir: /root/work/generated/images
      maxBytes: 10485760
    retry:
      budgetMs: 90000
      maxAttempts: 3
```

## Ayarlar

| Anahtar | Varsayılan | Anlamı |
| --- | --- | --- |
| `providers[].id` | — | Araçların kullandığı sağlayıcı kimliği. |
| `providers[].baseUrl` | `https://image.pollinations.ai/prompt` | Prompt uç noktası; kodlanmış prompt son yol parçası olarak eklenir. |
| `providers[].model` | `''` | İsteğe bağlı `model` sorgu parametresi. |
| `providers[].maxWidth` / `maxHeight` | `1024` | Bu sağlayıcıdan istenebilecek en büyük boyut. |
| `providers[].rateLimitMs` | `45000` | Bildirilen hız; modele raporlanır. |
| `providers[].timeoutMs` | `120000` | İstek başına HTTP zaman aşımı. |
| `defaults.provider` | ilk sağlayıcı | Çağrı sağlayıcı belirtmezse kullanılan. |
| `defaults.width` / `height` | `512` | Varsayılan görsel boyutu. |
| `output.dir` | `<DSH_HOME>/generated/images` | Görsellerin yazıldığı dizin. |
| `output.maxBytes` | `10485760` | Eklentinin yazacağı en büyük görsel. |
| `retry.budgetMs` | `90000` | Bir çağrının hız sınırının geçmesini bekleyebileceği süre. |
| `retry.maxAttempts` | `3` | Çağrı başına toplam HTTP denemesi. |

## Kendi sunucun

Aynı eklenti, prompt'u URL yolunda kabul edip görsel baytı döndüren yerel bir
üretim sunucusuyla da çalışır — örneğin önüne koyduğun bir Automatic1111/ComfyUI
arayüzü. `baseUrl`'i ona çevir; orada da anahtar gerekmez. Bu, genel ücretsiz uç
noktaya gizlilik dostu alternatiftir: prompt'lar makineden çıkmaz ve 45 saniyelik
hız sınırı olmaz.

## Dürüst sınırlar

- Genel ücretsiz uç noktalar hız sınırlıdır (yazım sırasında IP başına ~45 sn'de 1
  görsel), zaman zaman `503` döner ve koşullarını değiştirebilir.
- Görsel kalitesi, uç noktanın varsayılan modelinin ne ürettiğiyse odur.
- Prompt uç noktaya gönderilir; özel bir şey için genel uç nokta kullanma.

## Gereksinimler

- DSH `>= 0.2.1-rc.4` (Node `^22.19.0 || >=24.0.0`).
- Ayarlı uç noktaya giden HTTPS erişimi.

## Geliştirme

```bash
npm run link-peers   # yerel dsh kurulumundan @deepseek-ai peer paketlerini linkler
node --test
```

## Lisans

MIT
