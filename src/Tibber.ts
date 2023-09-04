import { TibberFeed, TibberQuery, IConfig } from 'tibber-api';
import { MqttClient } from './Mqtt';
import * as z from 'zod';

const TibberSubscriptionSchema = z.object({
    timestamp: z.string(),
    power: z.number(),
    accumulatedConsumption: z.number(),
    accumulatedProduction: z.number(),
    accumulatedCost: z.number(),
    minPower: z.number(),
    averagePower: z.number(),
    maxPower: z.number(),
    accumulatedReward: z.number().nullable(),
    powerProduction: z.number().nullable(),
    minPowerProduction: z.number().nullable(),
    maxPowerProduction: z.number().nullable(),
});

type TibberData = z.infer<typeof TibberSubscriptionSchema>;

const tibberKey: string = process.env.TIBBER_KEY
    ? process.env.TIBBER_KEY.toString()
    : '';

const homeId: string = process.env.TIBBER_ID_HOME
    ? process.env.TIBBER_ID_HOME.toString()
    : '';

const cabinId: string = process.env.TIBBER_ID_CABIN
    ? process.env.TIBBER_ID_CABIN.toString()
    : '';

console.log('Tibber Key: ' + tibberKey);
console.log('Home ID: ' + homeId);
console.log('Cabin ID: ' + cabinId);

// Config object needed when instantiating TibberQuery
const configBase: IConfig = {
    // Endpoint configuration.
    apiEndpoint: {
        apiKey: tibberKey,
        queryUrl: 'https://api.tibber.com/v1-beta/gql',
    },
    // Query configuration.
    timestamp: true,
    power: true,
    accumulatedConsumption: true,
    accumulatedProduction: true,
    accumulatedCost: true,
    accumulatedReward: true,
    minPower: true,
    averagePower: true,
    maxPower: true,
    powerProduction: true,
    minPowerProduction: true,
    maxPowerProduction: true,
    active: true,
};

const configHome: IConfig = { ...configBase, homeId: homeId };
const configCabin: IConfig = { ...configBase, homeId: cabinId };

// Instance of TibberQuery
const tibberQueryHome = new TibberQuery(configHome);
const tibberQueryCabin = new TibberQuery(configCabin);

const tibberFeedHome = new TibberFeed(tibberQueryHome, 5000);
const tibberFeedCabin = new TibberFeed(tibberQueryCabin, 5000);

export class Tibber {
    private mqttClient: MqttClient;
    private lastCabinPower = 0; // Hack to remember last power value

    // Create Tibber instances and start subscriptions
    public constructor(mqttClient: MqttClient) {
        this.mqttClient = mqttClient;
        tibberFeedHome.on('data', (data) => {
            this.parseData(data, 'home');
        });
        tibberFeedHome.connect().then(() => {
            console.log('Tibber home initiated');
        });
        tibberFeedCabin.on('data', (data) => {
            this.parseData(data, 'cabin');
        });
        tibberFeedCabin.connect().then(() => {
            console.log('Tibber cabin initiated');
        });
        // Start power price loop
        this.updatePowerprices();
    }

    private updatePowerprices() {
        tibberQueryHome.getCurrentEnergyPrice(homeId).then((data) => {
            // Publish to MQTT
            this.mqttClient.publish('price/home/total', data.total);
            this.mqttClient.publish('price/home/energy', data.energy);
            this.mqttClient.publish('price/home/tax', data.tax);
            this.mqttClient.publish('price/home/level', data.level);
            // TODO: Remove!
            this.mqttClient.publish('price/total', data.total);
            this.mqttClient.publish('price/energy', data.energy);
            this.mqttClient.publish('price/tax', data.tax);
            this.mqttClient.publish('price/level', data.level);
        });
        tibberQueryHome.getCurrentEnergyPrice(cabinId).then((data) => {
            // Publish to MQTT
            this.mqttClient.publish('price/cabin/total', data.total);
            this.mqttClient.publish('price/cabin/energy', data.energy);
            this.mqttClient.publish('price/cabin/tax', data.tax);
            this.mqttClient.publish('price/cabin/level', data.level);
        });
        setTimeout(
            () => {
                this.updatePowerprices();
            },
            10 + 60 * 1000 // Only need new prices every ten minutes!
        );
    }

    private updateUsage() {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public parseData(data: TibberData, where: 'home' | 'cabin'): void {
        const tibberValidated = TibberSubscriptionSchema.safeParse(data);
        if (tibberValidated.success) {
            const accumulatedConsumption =
                tibberValidated.data.accumulatedConsumption -
                tibberValidated.data.accumulatedProduction;

            const accumulatedCost =
                tibberValidated.data.accumulatedReward === null
                    ? tibberValidated.data.accumulatedCost
                    : tibberValidated.data.accumulatedCost -
                      tibberValidated.data.accumulatedReward;

            // Subtract production from power usage
            let power = tibberValidated.data.power;
            if (where === 'cabin') {
                // Hack to remember last power value
                if (
                    tibberValidated.data.power === 0 &&
                    tibberValidated.data.powerProduction !== null
                ) {
                    power = tibberValidated.data.powerProduction * -1;
                    this.lastCabinPower = power;
                } else if (
                    tibberValidated.data.power === 0 &&
                    tibberValidated.data.powerProduction === null
                ) {
                    power = this.lastCabinPower;
                }
            }
            // Publish to MQTT
            const mqttTopicBase = `${where}/`;

            this.mqttClient.publish(mqttTopicBase + 'power', power);
            this.mqttClient.publish(
                mqttTopicBase + 'accumulatedConsumption',
                accumulatedConsumption
            );
            this.mqttClient.publish(
                mqttTopicBase + 'accumulatedCost',
                accumulatedCost
            );
            this.mqttClient.publish(
                mqttTopicBase + 'powerProduction',
                tibberValidated.data.powerProduction
            );
            this.mqttClient.publish(
                mqttTopicBase + 'averagePower',
                tibberValidated.data.averagePower
            );
            this.mqttClient.publish(
                mqttTopicBase + 'maxPower',
                tibberValidated.data.maxPower
            );
            this.mqttClient.publish(
                mqttTopicBase + 'minPower',
                tibberValidated.data.minPower
            );
            if (tibberValidated.data.powerProduction) {
                this.mqttClient.publish(
                    mqttTopicBase + 'production',
                    tibberValidated.data.powerProduction
                );
            }
        } else {
            console.log('Tibber data not valid');
        }
    }
}
