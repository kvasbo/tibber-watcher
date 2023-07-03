import { MqttClient } from './Mqtt';
import { Tibber } from './Tibber';

// End after five seconds if testing
if(process.argv[2] !== 'test') 
{ 
    console.log('Starting Tibber Watcher');
    const mqttClient = new MqttClient();
    new Tibber(mqttClient);
} else {
  console.log("This is just a smoke test!");
  setTimeout(() => {
      process.exit(0);
  }, 2000); 
}