/* eslint-disable no-unused-vars */

export enum EnergyResolution {
    HOURLY = 'HOURLY',
    DAILY = 'DAILY',
    WEEKLY = 'WEEKLY',
    MONTHLY = 'MONTHLY',
    ANNUAL = 'ANNUAL',
}

export type Place = 'home' | 'cabin';

export interface Places {
    [key: string]: {
        id: string;
        name: Place;
    };
}

export interface PowerStatusForPlace {
    power: number;
    day: {
        accumulatedConsumption: number;
        accumulatedProduction: number;
        accumulatedCost: number;
    };
    month: {
        accumulatedConsumption: number;
        accumulatedProduction: number;
        accumulatedCost: number;
    };
    minPower: number;
    averagePower: number;
    maxPower: number;
    accumulatedReward: number;
    powerProduction: number;
    minPowerProduction: number;
    maxPowerProduction: number;
    usageForDay: UsageForDay;
    usageForTodayLastHourSeen: number; // To be used for figuring out usage last hour by subtracting realtime from this value.
    usageForTodayUpToThisHour: number; // To be used for figuring out usage last hour by subtracting realtime from this value.
    prices: PowerPriceDay;
}
export interface UsageForDay {
    [key: number]: {
        consumption: number;
        production?: number;
        totalIncVat: number;
        transportIncVat: number;
        energyIncVat: number;
    };
}

export interface PowerPriceDay {
    [key: number]: {
        energy: number;
        tax: number;
        transportCost: number;
        energyAfterSupport: number;
        totalAfterSupport: number;
    };
}

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
