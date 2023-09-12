import { MqttClient } from './Mqtt';
import { Tibber } from './Tibber';
import Express from 'express';

const app = Express();

console.log('Starting Tibber Watcher');
const mqttClient = new MqttClient();
const t = new Tibber(mqttClient);

app.get('/', (req, res) => {
    const data = t.getDataSet();
    res.send(JSON.stringify(data, null, '  '));
});

app.listen(3000, () => {
    console.log('Example app listening on port 3000!');
});
