import { TibberFeed, TibberQuery, IConfig } from 'tibber-api';
import * as z from 'zod';
import { MqttClient } from './Mqtt';
import { DateTime } from 'luxon';
import { PowerPrices } from './PowerPrices';
import { usageQuery, usageQueryResponse } from './TibberQueries';
import {
    IConsumption,
    Place,
    PowerStatus,
    PowerStatusForPlace,
    Places,
} from './Types';

const TibberSubscriptionSchema = z.object({
    timestamp: z.string(),
    power: z.number(),
    accumulatedConsumption: z.number(),
    accumulatedProduction: z.number(),
    accumulatedCost: z.number().nullable(),
    minPower: z.number(),
    averagePower: z.number(),
    maxPower: z.number(),
    accumulatedReward: z.number().nullable(),
    powerProduction: z.number().nullable(),
    minPowerProduction: z.number().nullable(),
    maxPowerProduction: z.number().nullable(),
});

export type TibberData = z.infer<typeof TibberSubscriptionSchema>;

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

const tibberFeedHome = new TibberFeed(tibberQueryHome);
const tibberFeedCabin = new TibberFeed(tibberQueryCabin);

export class Tibber {
    private mqttClient: MqttClient;
    private lastCabinPower: number = 0; // Hack to handle intermittent power production data

    // The new structure for everything!
    private status: PowerStatus = {
        home: structuredClone(statusInitValues),
        cabin: structuredClone(statusInitValues),
    };

    // Create Tibber instances and start subscriptions
    public constructor(mqttClient: MqttClient) {
        this.mqttClient = mqttClient;

        // this.updateData();
        this.connectToTibber();

        // this.connectToTibber();
        // setInterval(() => this.updateData(), 1000 * 60 * 5); // Update data every five minutes
        setInterval(() => this.sendToMQTT(), 1000 * PUSH_INTERVAL); // Update MQTT every 15 secs.
    }

    // Init data that needs to be in place in order to have correct data for later computations
    private async updateData() {
        await this.updateUsage();
        console.log('Tibber data fetched.');
    }

    /**
     * Connect to Tibber with a delay to avoid hammering the API
     */
    private async connectToTibber() {
        setTimeout(async () => {
            tibberFeedHome.on('data', (data) => {
                this.parseRealtimeData(data, 'home');
            });
            await tibberFeedHome.connect();
            console.log('Tibber home initiated');
        }, Math.random() * 5000);
        setTimeout(async () => {
            tibberFeedCabin.on('data', (data) => {
                this.parseRealtimeData(data, 'cabin');
            });
            await tibberFeedCabin.connect();
            console.log('Tibber cabin initiated');
        }, Math.random() * 5000);
    }

    // The new nice all-in-one-update function
    private async updateUsage() {
        // Just get the whole month (with a bit of slack)
        const hoursToGet = DateTime.now().day * 24;
        const currentHour = DateTime.now().hour;

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
            const todayStart = DateTime.now()
                .setZone('Europe/Oslo')
                .startOf('day');

            // Get consumption
            const consumption = home.consumption.nodes;
            const monthSoFar = await this.calculateUsageForPeriod(
                consumption as IConsumption[],
                DateTime.now().startOf('month').toJSDate()
            );
            this.status[place.name].month.accumulatedConsumption = monthSoFar;
            console.log('Parsing data for', place.name);
            console.log('Month so far', monthSoFar);

            // Get consumption for today up to last hour
            const todaySoFar = await this.calculateUsageForPeriod(
                consumption as IConsumption[],
                DateTime.now().startOf('day').toJSDate(),
                DateTime.now().startOf('hour').toJSDate()
            );

            this.status[place.name].usageForTodayUpToThisHour = todaySoFar;

            // Update price data
            const priceData = home.currentSubscription.priceInfo.today;
            // Hack as cabins have no support
            const usageForCalc = place.name === 'cabin' ? 999999 : monthSoFar;

            priceData.forEach((p) => {
                const t = DateTime.fromISO(p.startsAt).setZone('Europe/Oslo');
                const d = t.toJSDate();
                const key = t.hour;
                const transportCost = PowerPrices.getCurrentTransportCost(d);
                const energyAfterSupport =
                    PowerPrices.getCurrentPriceAfterSupport(
                        p.energy,
                        usageForCalc // Hack as cabins have no support
                    ) + p.tax;
                const totalAfterSupport = energyAfterSupport + transportCost;
                this.status[place.name].prices[key] = {
                    energy: p.energy,
                    tax: p.tax,
                    transportCost: transportCost,
                    energyAfterSupport: energyAfterSupport, // Energy plus tax minus support
                    totalAfterSupport: totalAfterSupport, // What we actually pay
                };
            });

            // Get usage for the day, by the hour
            const todayUsage = consumption.filter((data) => {
                const date = DateTime.fromISO(data.from).setZone('Europe/Oslo');
                return date.hasSame(todayStart, 'day');
            });

            const lastSeen = this.findLatestStartTimeInDataSet(todayUsage);
            this.status[place.name].usageForTodayLastHourSeen = lastSeen.hour;

            todayUsage.forEach((data) => {
                const date = DateTime.fromISO(data.from).setZone('Europe/Oslo');
                const hour = date.hour;
                const usage = data.consumption;
                const priceData = this.status[place.name].prices[hour];
                const energyCost = priceData.energyAfterSupport * usage;
                const transportCost = priceData.transportCost * usage;
                const totalCost = energyCost + transportCost;
                this.status[place.name].usageForDay[hour] = {
                    consumption: usage,
                    totalIncVat: totalCost,
                    transportIncVat: transportCost,
                    energyIncVat: energyCost,
                };
            });

            // Update current price
            this.status[place.name].currentPrice =
                this.status[place.name].prices[currentHour];
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
        const fromDate = DateTime.fromJSDate(from);
        const toDate = DateTime.fromJSDate(to);
        const thisMonth = usageData.filter((data) => {
            const date = DateTime.fromISO(data.from);
            return date >= fromDate && date <= toDate;
        });
        const totalUsage = Math.round(
            thisMonth.reduce((acc, cur) => {
                return acc + cur.consumption;
            }, 0)
        );
        return totalUsage;
    }

    /**
     * Try to calculate actual spend so far today by looking at data up to last hour and then adding realtime data.
     * Not exact!
     */
    private calculateAccumulatedCostForDay(
        realtime: TibberData,
        where: Place
    ): { total: number } {
        // Find difference between realtime data and today up to last hour
        const unAccountedFor =
            realtime.accumulatedConsumption -
            this.status[where].usageForTodayUpToThisHour;

        // Find cost and usage for today up until now
        const properSumsTodaySoFar = this.getSumsForToday(where);
        const prices = this.status[where].prices[DateTime.now().hour];

        const estimatedTotalUnaccounted =
            unAccountedFor * prices.totalAfterSupport;

        return {
            total:
                estimatedTotalUnaccounted +
                properSumsTodaySoFar.accumulatedCost,
        };
    }

    /**
     * Helper to sum up usage and cost for today
     */
    private getSumsForToday(where: Place): {
        accumulatedConsumption: number;
        accumulatedCost: number;
    } {
        const hours = Object.values(this.status[where].usageForDay);
        const consumption = hours.reduce((acc, cur) => {
            return acc + cur.consumption * 1;
        }, 0);
        const cost = hours.reduce((acc, cur) => {
            return acc + cur.totalIncVat * 1;
        }, 0);
        return {
            accumulatedConsumption: consumption,
            accumulatedCost: cost,
        };
    }

    /**
     * Find the latest point in a data set as defined by its starting time
     */
    private findLatestStartTimeInDataSet(data: { from: string }[]): DateTime {
        const sorted = data.sort((a, b) => {
            const aDate = DateTime.fromISO(a.from);
            const bDate = DateTime.fromISO(b.from);
            return aDate > bDate ? -1 : 1;
        });
        return DateTime.fromISO(sorted[0].from).setZone('Europe/Oslo');
    }

    /**
     * Parse subscribtion data
     * @param data
     * @param where
     */
    public parseRealtimeData(data: TibberData, where: Place): void {
        const tibberValidated = TibberSubscriptionSchema.safeParse(data);
        if (tibberValidated.success) {
            const accumulatedConsumption =
                tibberValidated.data.accumulatedConsumption -
                tibberValidated.data.accumulatedProduction;

            // Subtract production from power usage. If production is null, use last known value
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

            // Figure out the hard part
            /*
            const accumulatedData = this.calculateAccumulatedCostForDay(
                tibberValidated.data,
                where
            );
            */

            // Update the status object
            this.status[where].power = power;
            this.status[where].day.accumulatedConsumption =
                accumulatedConsumption;
            // this.status[where].day.accumulatedCost = accumulatedData.total;
            this.status[where].day.accumulatedProduction =
                tibberValidated.data.accumulatedProduction;

            console.log('Accumulated Data for ' + where);
            console.table(this.status[where].day);
            console.log('Power: ' + power);
        } else {
            console.log(tibberValidated.error);
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
    usageForTodayLastHourSeen: 0,
    usageForTodayUpToThisHour: 0,
    prices: {},
    currentPrice: {
        energy: 0,
        tax: 0,
        transportCost: 0,
        energyAfterSupport: 0,
        totalAfterSupport: 0,
    },
};
