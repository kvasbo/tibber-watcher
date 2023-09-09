import * as z from 'zod';

export enum EnergyResolution {
    HOURLY = 'HOURLY',
    DAILY = 'DAILY',
    WEEKLY = 'WEEKLY',
    MONTHLY = 'MONTHLY',
    ANNUAL = 'ANNUAL',
}

export type Place = 'home' | 'cabin';

export interface PowerStatusForPlace {
    updated: Date;
    power: number;
    accumulatedConsumption: number;
    accumulatedProduction: number;
    accumulatedCost: number;
    minPower: number;
    averagePower: number;
    maxPower: number;
    accumulatedReward: number;
    powerProduction: number;
    minPowerProduction: number;
    maxPowerProduction: number;
    currentPrice: number;
    usageForDay: UsageForDay;
}
export interface UsageForDay {
    [key: hours]: {
        consumption: number;
        production: number;
        total: number;
        price: number;
    };
}

// Yeah... I know
type hours =
    | 0
    | 1
    | 2
    | 3
    | 4
    | 5
    | 6
    | 7
    | 8
    | 9
    | 10
    | 11
    | 12
    | 13
    | 14
    | 15
    | 16
    | 17
    | 18
    | 19
    | 20
    | 21
    | 22
    | 23;

// Hold the current status for a place.
export interface PowerStatus {
    home: PowerStatusForPlace;
    cabin: PowerStatusForPlace;
}

export interface IConsumption {
    homeId?: string;
    from: string;
    to: string;
    unitPrice: number;
    unitPriceVAT: number;
    consumption: number;
    consumptionUnit: string;
    cost: number;
    currency: string;
}

export interface IPrice {
    homeId?: string;
    total: number;
    energy: number;
    tax: number;
    startsAt: string;
    level: string;
}

export const TibberSubscriptionSchema = z.object({
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

export type TibberData = z.infer<typeof TibberSubscriptionSchema>;
