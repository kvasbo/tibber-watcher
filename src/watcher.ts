import { MqttClient } from './Mqtt';
import { Tibber } from './Tibber';
import Express from 'express';

const app = Express();

console.log('Starting Tibber Watcher');
const mqttClient = new MqttClient();
const t = new Tibber(mqttClient);

app.get('/', (req, res) => {
    const data = t.getDataSet();
    res.send(
        `<html><body><pre><code>${JSON.stringify(
            data,
            null,
            '  '
        )}</code></pre></body></html>`
    );
});

app.listen(3000, () => {
    console.log('Tibber watcher listening on port 3000!');
});

// Handle Sigterm
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down');
    process.exit(0);
});
