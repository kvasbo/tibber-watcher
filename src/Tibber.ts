import { TibberFeed, TibberQuery, IConfig } from 'tibber-api';
import { MqttClient } from './Mqtt';
import { DateTime } from 'luxon';
import { PowerPrices } from './PowerPrices';
import {
    EnergyResolution,
    IConsumption,
    IPrice,
    TibberSubscriptionSchema,
    TibberData,
    Place,
} from './Types';

const MIN_PUSH_INTERVAL = 15 * 1000; // 15 seconds!

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

interface powerUsedThisMonth {
    home: number;
    cabin: number;
}

export class Tibber {
    private mqttClient: MqttClient;
    private lastCabinPower = 0; // Hack to remember last power value

    // Make sure we don't push too often, we don't need every second.
    private lastPushTimes = {
        home: 0,
        cabin: 0,
    };

    private powerUsedThisMonth: powerUsedThisMonth = {
        home: 0,
        cabin: 0,
    };

    // Create Tibber instances and start subscriptions
    public constructor(mqttClient: MqttClient) {
        this.mqttClient = mqttClient;

        // Start power price loop
        this.updatePowerprices();
        this.updateUsage();
        // this.connectToTibber();
    }

    /**
     * Connect to Tibber with a delay to avoid hammering the API
     */
    private connectToTibber() {
        setTimeout(
            () => {
                tibberFeedHome.connect().then(() => {
                    console.log('Tibber home initiated');
                });
                tibberFeedHome.on('data', (data) => {
                    this.parseData(data, 'home');
                });
                tibberFeedHome.on('error', (error) => {
                    console.log('Tibber home error: ' + error);
                });
            },
            Math.random() * 1000 * 15 + 4000
        );
        setTimeout(
            () => {
                tibberFeedCabin.connect().then(() => {
                    console.log('Tibber cabin initiated');
                });
                tibberFeedCabin.on('error', (error) => {
                    console.log('Tibber cabin error: ' + error);
                });
                tibberFeedCabin.on('data', (data) => {
                    this.parseData(data, 'cabin');
                });
            },
            Math.random() * 1000 * 15 + 4000
        );
    }

    private async updatePowerprices() {
        // Get and parse home power prices
        const dataHome: IPrice =
            await tibberQueryHome.getCurrentEnergyPrice(homeId);
        this.parsePowerPrices(dataHome, 'home');

        // Get and parse cabin power prices
        const dataCabin = await tibberQueryHome.getCurrentEnergyPrice(cabinId);
        this.parsePowerPrices(dataCabin, 'cabin');

        setTimeout(
            () => {
                this.updatePowerprices();
            },
            60 * 1000 // Every minute
        );
    }

    private async parsePowerPrices(data: IPrice, where: Place) {
        this.sendToMQTT(where, 'total', data.total);
        this.sendToMQTT(where, 'energy', data.energy);
        this.sendToMQTT(where, 'tax', data.tax);
        this.sendToMQTT(where, 'level', data.level);

        const cabinIncludingFees = PowerPrices.getCurrentPrice(
            data.energy,
            new Date(),
            this.powerUsedThisMonth[where]
        );

        this.sendToMQTT(where, 'energyIncludingFees', cabinIncludingFees);
        this.sendToMQTT(
            where,
            'energyIncludingFeesAndVat',
            cabinIncludingFees * 1.25
        );
    }

    private async getMonthlyUsageSoFar(
        usageData: IConsumption[]
    ): Promise<number> {
        const startOfMonth = DateTime.now().startOf('month');
        const thisMonth = usageData.filter((data) => {
            const date = DateTime.fromISO(data.from);
            return date >= startOfMonth;
        });
        const totalUsage = Math.round(
            thisMonth.reduce((acc, cur) => {
                return acc + cur.consumption;
            }, 0)
        );
        return totalUsage;
    }

    private async updateUsage() {
        const hoursToGet = DateTime.now().day * 24; // Just get the whole month (with a bit of slack)
        const consumptionHome = await tibberQueryHome.getConsumption(
            EnergyResolution.HOURLY,
            hoursToGet,
            homeId
        );

        const homeUsageThisMonth =
            await this.getMonthlyUsageSoFar(consumptionHome);
        this.powerUsedThisMonth.home = homeUsageThisMonth;
        const homeCostToday = await this.parseUsage(
            consumptionHome,
            homeUsageThisMonth
        );

        this.sendToMQTT('home', 'usedThisMonth', homeUsageThisMonth);
        this.sendToMQTT('home', 'costToday', homeCostToday);

        const consumptionCabin = await tibberQueryHome.getConsumption(
            EnergyResolution.HOURLY,
            hoursToGet,
            cabinId
        );

        const cabinUsedThisMonth =
            await this.getMonthlyUsageSoFar(consumptionCabin);

        this.powerUsedThisMonth.cabin = cabinUsedThisMonth;
        const cabinCostToday = await this.parseUsage(consumptionCabin, 999999); // No support in cabin

        // Publish to MQTT
        this.sendToMQTT('cabin', 'usedThisMonth', cabinUsedThisMonth);
        this.sendToMQTT('cabin', 'costToday', cabinCostToday);
        setTimeout(
            () => {
                this.updateUsage();
            },
            60 * 1000 // Only need consumption every ten minutes!
        );
    }

    // Parse usage data and find actual cost.
    private async parseUsage(
        usageData: IConsumption[],
        usedThisMonthSoFar: number
    ): Promise<number> {
        // If in cabin, no support!
        const startOfDay = DateTime.now().setZone('Europe/Oslo').startOf('day');
        // Filter data to only today
        const today = usageData.filter((data) => {
            const date = DateTime.fromISO(data.from).setZone('Europe/Oslo');
            return date >= startOfDay;
        });
        const cost = today.map((data) => {
            const date = DateTime.fromISO(data.from)
                .setZone('Europe/Oslo')
                .toJSDate();
            const price = PowerPrices.getCurrentPrice(
                data.unitPrice,
                date,
                usedThisMonthSoFar
            );
            return {
                ...data,
                priceWithFees: price,
                priceWithFeesAndVAT: price * 1.25,
            };
        });

        // Calculate total cost today (up until start of last hour)
        const totalCost = cost.reduce((acc, cur) => {
            return acc + cur.priceWithFees;
        }, 0);

        return totalCost;
    }

    public parseData(data: TibberData, where: Place): void {
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

            // Make sure we don't push too often, we don't need every second.
            const now = Date.now();
            if (now - this.lastPushTimes[where] < MIN_PUSH_INTERVAL) {
                return;
            }

            this.lastPushTimes[where] = now;

            // Publish to MQTT
            this.sendToMQTT(where, 'power', power);

            this.sendToMQTT(
                where,
                'accumulatedConsumption',
                accumulatedConsumption
            );

            this.sendToMQTT(where, 'accumulatedCost', accumulatedCost);
            this.sendToMQTT(
                where,
                'powerProduction',
                tibberValidated.data.powerProduction
            );
            this.sendToMQTT(
                where,
                'averagePower',
                tibberValidated.data.averagePower
            );
            this.sendToMQTT(where, 'maxPower', tibberValidated.data.maxPower);
            this.sendToMQTT(where, 'minPower', tibberValidated.data.minPower);
            if (tibberValidated.data.powerProduction) {
                this.sendToMQTT(
                    where,
                    'production',
                    tibberValidated.data.powerProduction
                );
            }
        } else {
            console.log('Tibber data not valid');
        }
    }

    private sendToMQTT(where: string, what: string, value: number | string) {
        // Publish to MQTT
        const mqttTopicBase = `${where}/`;
        this.mqttClient.publish(mqttTopicBase + what, value);
    }
}
