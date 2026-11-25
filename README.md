# Helios

Helios is a local dashboard for the Solis S6-GR1P6K inverter with an S3-WIFI-ST data logger. It shows live power, production history, and estimates from readings saved on your computer.

## Run
Install Go 1.26 or newer. Connect your computer to the same network as the data logger, then run from the project directory:

```sh
cp .env.example .env
go run ./cmd/helios
```

Open the compiled application. Click **Devices**, select the data logger, and enter the password for its local web page. You can also set `S3_IP` and `S3_PASSWORD` in `.env`; with only `S3_PASSWORD`, Helios discovers the logger automatically. Credentials entered in the panel are saved in `data/local-settings.json` and take precedence over nonempty `.env` values on later starts.

Helios reads `http://LOGGER_IP/inverter.cgi` about once a minute and saves readings in `data/`. Without a configured logger, the dashboard shows labeled sample data. If a connected logger stops responding, Helios keeps the last reading and scans the local network automatically (at most once every two minutes). When it identifies the same collector at a new IP, it reconnects with the locally saved password and updates the saved IP. The computer must remain on the same local network; this does not reconnect a disconnected Wi-Fi connection.

## Weather and production forecast

To enable the [OpenWeather 5-day forecast](https://openweathermap.org/api/forecast5), set `OPENWEATHER_API_KEY`, `OPENWEATHER_LAT`, and `OPENWEATHER_LON` in `.env` and restart Helios. Use your [OpenWeather API key](https://home.openweathermap.org/api_keys) and the solar panels' coordinates in decimal degrees with a dot. Set `TIME_ZONE` to the panels' local time zone. The key stays on the server.

Open **Histórico -> Previsão de geração** (**History -> Production forecast**). Helios shows temperatures and daytime cloud cover for complete upcoming days in the 3-hour forecast. With at least five recorded days in the last 30, it estimates daily generation between the historical 20th and 80th percentiles, with clearer skies closer to the upper end. It displays the sum and daily average of those estimates. Weather remains visible with less history, and Helios uses the existing historical projection if weather is unavailable.

## Notes

- The logger and computer must be on the same local network. If discovery fails, enter the logger's IP manually.
- History starts when Helios begins recording. Missing days are not counted as zero production.
- Peaks are the highest values observed during polling. A higher peak between readings may be missed.
- Monetary values use the configured BRL/kWh rate. They are estimates, not electricity bill savings.
- To access the dashboard from another device on your network, set `HOST` to your computer's local IP and allow the port through its firewall.

## Development

```sh
go test ./...   # Test the backend, embedded assets, and Windows desktop integration
go vet ./...
go build -o dist/helios-web.exe ./cmd/helios   # Build the web server on Windows
```

The browser loads the JavaScript modules in `public/` directly. Rebuild the Go binary after changing an embedded asset. Use `-dir PATH` to point the web server to a different directory for `.env` and `data/`. With Node.js 22 or newer, run the optional browser-storage unit tests with `node --test tests/offline-store.test.mjs`.

## Windows executable

With Go 1.26+ installed on Windows, run `./desktop/build.ps1` in PowerShell. Copy `dist/helios.exe` to a writable folder and double-click it. Helios opens in a Wails window and runs the Go service in the same process. The target computer needs [Microsoft Edge WebView2 Runtime](https://v3.wails.io/guides/build/windows/#webview2-missing).

## Credit

The logo uses [House Martell.svg](https://awoiaf.westeros.org/index.php/File:House_Martell.svg) by [Abjiklam](https://awoiaf.westeros.org/index.php/User:Abjiklam), licensed under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). The app icons use the same license.

Weather data and the weather provider logo are from [OpenWeather](https://openweathermap.org/). The [logo copy](https://github.com/theothernt/AerialViews/blob/master/docs/images/openweather_logo.png) was sourced from Aerial Views.
