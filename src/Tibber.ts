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

export class Tibber {
    private mqttClient: MqttClient;

    // The new structure for everything!
    private powerPrices: PowerPriceDay[] = []; // Init empty array for power prices
    private status: PowerStatus = {
        home: structuredClone(statusInitValues),
        cabin: structuredClone(statusInitValues),
    };

    // Create Tibber instances and start subscriptions
    public constructor(mqttClient: MqttClient) {
        this.mqttClient = mqttClient;

        this.updateData();
        this.connectToTibber();

        // this.connectToTibber();
        setInterval(() => this.updateData(), 1000 * 60 * 5); // Update data every five minutes
        setInterval(() => this.sendToMQTT(), 1000 * PUSH_INTERVAL); // Update MQTT every 15 secs.
    }

    // Init data that needs to be in place in order to have correct data for later computations
    private async updateData() {
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
                    // this.parseData(data, 'home');
                    console.log(data);
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
                    console.log(data);
                    //this.parseData(data, 'cabin');
                });
            },
            Math.random() * 1000 * 15 + 4000
        );
    }

    // The new nice all-in-one-update function
    private async updateUsage() {
        // Just get the whole month (with a bit of slack)
        const hoursToGet = DateTime.now().day * 24;

        // Create the query
        const query = usageQuery.replace(
            /HOURS_TO_GET/g,
            hoursToGet.toString()
        );

        // Get the data
        const data: usageQueryResponse = await tibberQuery.query(query);

        // Run through all homes and get consumption, prices etc.
        data.viewer.homes.forEach(async (home) => {
            // Find the place
            const place = places[home.id];

            // Get consumption
            const consumption = home.consumption.nodes;
            const monthSoFar = await this.calculateUsageForPeriod(
                consumption as IConsumption[],
                DateTime.now().startOf('month').toJSDate()
            );
            this.status[place.name].month.accumulatedConsumption = monthSoFar;
            console.log('Parsing data for', place.name);
            console.log('Month so far', monthSoFar);

            // Update price data
            const priceData = home.currentSubscription.priceInfo.today;
            // Hack as cabins have no support
            const usageForCalc = place.name === 'cabin' ? 999999 : monthSoFar;

            priceData.forEach((p) => {
                const t = DateTime.fromISO(p.startsAt).setZone('Europe/Oslo');
                const d = t.toJSDate();
                const key = t.hour;
                this.status[place.name].prices[key] = {
                    energy: p.energy,
                    tax: p.tax,
                    total: p.total,
                    transportCost: PowerPrices.getCurrentTransportCost(d),
                    energyAfterSupport: PowerPrices.getCurrentPriceAfterSupport(
                        p.energy,
                        usageForCalc // Hack as cabins have no support
                    ),
                };
            });

            // Calculate cost
            const todayStart = DateTime.now()
                .setZone('Europe/Oslo')
                .startOf('day')
                .toJSDate();
            const monthStart = DateTime.now()
                .setZone('Europe/Oslo')
                .startOf('month')
                .toJSDate();
            const costToday = this.calculateCosts(
                consumption as IConsumption[],
                todayStart
            );
            const costMonth = this.calculateCosts(
                consumption as IConsumption[],
                monthStart
            );
            console.log('Cost', place.name, costToday, costMonth);
        });
    }

    /**
     *
     * @param usageData
     * @returns
     */
    private async calculateUsageForPeriod(
        usageData: IConsumption[],
        from: Date,
        to: Date = new Date()
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

    /**
     * Calculates the cost for a given period
     * @param usageData Consumption data
     * @param from Start time
     * @param to  End time
     * @returns Total cost
     */
    private calculateCosts(
        usageData: IConsumption[],
        from: Date,
        to: Date = new Date()
    ): number {
        // Filter data to only after given date
        const filtered = usageData.filter((data) => {
            const date = DateTime.fromISO(data.from)
                .setZone('Europe/Oslo')
                .toJSDate();
            return date >= from && date <= to;
        });
        // Calculate total cost
        const totalCost = filtered.reduce((acc, cur) => {
            if (!cur.consumption) return acc;
            return acc + cur.unitPrice * cur.consumption;
        }, 0);
        return totalCost;
    }

    /**
     * Parse subscribtion data
     * @param data
     * @param where
     */
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
                    // this.lastCabinPower = power;
                } else if (
                    tibberValidated.data.power === 0 &&
                    tibberValidated.data.powerProduction === null
                ) {
                    // power = this.lastCabinPower;
                }
            }
        } else {
            console.log('Tibber data not valid');
        }
    }

    // For debugging
    public getDataSet() {
        return this.status;
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
