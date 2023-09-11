import { TibberFeed, TibberQuery, IConfig } from 'tibber-api';
import { MqttClient } from './Mqtt';
import { DateTime } from 'luxon';
import { PowerPrices } from './PowerPrices';
import { usageQuery, usageQueryResponse } from './TibberQueries';
import {
    EnergyResolution,
    IConsumption,
    IPrice,
    TibberSubscriptionSchema,
    TibberData,
    Place,
    PowerPriceDay,
    PowerStatus,
    PowerStatusForPlace,
    Places,
} from './Types';

const PUSH_INTERVAL = 15; // 15 seconds!

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

if (!tibberKey || !homeId || !cabinId) {
    console.log('Missing Tibber config');
    process.exit();
}

const places: Places = {
    home: { id: homeId, name: 'home' },
    cabin: { id: cabinId, name: 'cabin' },
};
places[homeId] = places.home;
places[cabinId] = places.cabin; // Add reverse lookup

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
const tibberQuery = new TibberQuery(configBase);

const tibberFeedHome = new TibberFeed(tibberQueryHome, 5000);
const tibberFeedCabin = new TibberFeed(tibberQueryCabin, 5000);

interface powerUsedThisMonth {
    home: number;
    cabin: number;
}

export class Tibber {
    private mqttClient: MqttClient;
    private lastCabinPower = 0; // Hack to remember last power value

    // New data set
    private powerPrices: PowerPriceDay[] = []; // Init empty array for power prices

    // The new structure for everything!
    private status: PowerStatus = {
        home: structuredClone(statusInitValues),
        cabin: structuredClone(statusInitValues),
    };

    // End new data set

    private powerUsedThisMonth: powerUsedThisMonth = {
        home: 0,
        cabin: 0,
    };

    // Create Tibber instances and start subscriptions
    public constructor(mqttClient: MqttClient) {
        this.mqttClient = mqttClient;

        this.updateData();

        // this.connectToTibber();
        setInterval(() => this.updateData(), 1000 * 60 * 5); // Update data every five minutes
        setInterval(() => this.sendToMQTT(), 1000 * PUSH_INTERVAL); // Update MQTT every 15 secs.
    }

    // Init data that needs to be in place in order to have correct data for later computations
    private async updateData() {
        // await this.updatePrices();
        await this.updateUsage();
        console.log('Init data done');
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

    // The new nice all-in-one-update function
    private async updateUsage() {
        const hoursToGet = DateTime.now().day * 24; // Just get the whole month (with a bit of slack)

        const query = usageQuery.replace(
            /HOURS_TO_GET/g,
            hoursToGet.toString()
        );

        const data: usageQueryResponse = await tibberQuery.query(query);

        // Run through all homes and get consumption, prices etc.
        data.viewer.homes.forEach(async (home) => {
            // Find the place
            const place = places[home.id];

            // Update price data
            const priceData = home.currentSubscription.priceInfo.today;
            priceData.forEach((p) => {
                const t = DateTime.fromISO(p.startsAt).setZone('Europe/Oslo');
                const key = t.hour;
                this.status[place.name].prices[key] = {
                    energy: p.energy,
                    tax: p.tax,
                    total: p.total,
                };
            });

            // Get consumption
            const consumption = home.consumption.nodes;
            const monthSoFar = await this.getMonthlyUsageSoFar(
                consumption as IConsumption[]
            );
            this.status[place.name].month.accumulatedConsumption = monthSoFar;
            console.log('Parsing data for', place.name);
            console.log('Month so far', monthSoFar);

            // Get cost
            const costToday = await this.parseUsage(
                consumption as IConsumption[],
                monthSoFar
            );
            console.log('Cost', costToday);

            // Get prices
            const prices = home.currentSubscription.priceInfo.today;
            console.log(prices.length);
        });

        // Deprecated from hereon out
        const consumptionHome = await tibberQuery.getConsumption(
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

        const consumptionCabin = await tibberQuery.getConsumption(
            EnergyResolution.HOURLY,
            hoursToGet,
            cabinId
        );

        const cabinUsedThisMonth =
            await this.getMonthlyUsageSoFar(consumptionCabin);

        this.powerUsedThisMonth.cabin = cabinUsedThisMonth;
        const cabinCostToday = await this.parseUsage(consumptionCabin, 999999); // No support in cabin
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
        } else {
            console.log('Tibber data not valid');
        }
    }

    private sendToMQTT() {
        // Publish to MQTT
        this.mqttClient.publish('power', JSON.stringify(this.status));
    }
}

const statusInitValues: PowerStatusForPlace = {
    power: 0,
    day: {
        accumulatedConsumption: 0,
        accumulatedProduction: 0,
        accumulatedCost: 0,
    },
    month: {
        accumulatedConsumption: 0,
        accumulatedProduction: 0,
        accumulatedCost: 0,
    },
    minPower: 0,
    averagePower: 0,
    maxPower: 0,
    accumulatedReward: 0,
    powerProduction: 0,
    minPowerProduction: 0,
    maxPowerProduction: 0,
    usageForDay: {},
    prices: {},
};
