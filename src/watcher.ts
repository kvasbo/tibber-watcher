import { TibberFeed, TibberQuery, IConfig } from 'tibber-api';
import { MqttClient } from './Mqtt';
import { Tibber } from './Tibber';
import * as z from 'zod';
import * as dotenv from 'dotenv';

console.log("Starting Tibber Watcher");

dotenv.config();

const mqttClient = new MqttClient();

const tibber = new Tibber(mqttClient);