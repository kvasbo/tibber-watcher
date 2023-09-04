export interface PowerPriceData {
    currentSpotPriceWithVAT: number;
    currentTotalPriceWithVAT: number;
    currentFeesWithVAT: number;
}

export class PowerPrices {
    private static readonly VAT = 1.25;
    private static readonly WINTER_NIGHT_OR_WEEKEND_PRICE = 0.2895;
    private static readonly WINTER_DAY_PRICE = 0.352;
    private static readonly SUMMER_NIGHT_OR_WEEKEND_PRICE = 0.373;
    private static readonly SUMMER_DAY_PRICE = 0.4355;

    // Calculate the current full power price with fees and VAT
    public static getCurrentPrice(
        currentSpotPriceIncVAT: number,
        when: Date
    ): number {
        const winter = PowerPrices.isItWinterPrice(when);
        const nightOrWeekend = PowerPrices.isItNightOrWeekendPrice(when);

        // Not elegant, but hey
        if (winter) {
            if (nightOrWeekend) {
                return (
                    currentSpotPriceIncVAT +
                    PowerPrices.WINTER_NIGHT_OR_WEEKEND_PRICE
                );
            } else {
                return currentSpotPriceIncVAT + PowerPrices.WINTER_DAY_PRICE;
            }
        } else {
            if (nightOrWeekend) {
                return (
                    currentSpotPriceIncVAT +
                    PowerPrices.SUMMER_NIGHT_OR_WEEKEND_PRICE
                );
            } else {
                return currentSpotPriceIncVAT + PowerPrices.SUMMER_DAY_PRICE;
            }
        }
    }

    /**
     * Correct for night or weekend prices
     * @param time
     * @returns
     */
    private static isItNightOrWeekendPrice(time: Date): boolean {
        const hour = time.getHours();
        const day = time.getDay();
        // Weekend
        if (day === 0 || day === 6) {
            return true;
        }
        // Night
        if ((hour >= 0 && hour <= 5) || (hour >= 22 && hour <= 23)) {
            return true;
        }
        return false;
    }

    /**
     * Correct for winter price
     * @param time
     * @returns
     */
    private static isItWinterPrice(time: Date): boolean {
        const month = time.getMonth();
        if (month >= 0 && month <= 2) {
            return true;
        }
        return false;
    }
}
