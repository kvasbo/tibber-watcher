export class PowerPrices {
    private static readonly SUPPORT_CUTOFF_USAGE = 5000;
    private static readonly SUPPORT_ENTRY_PRICE = 0.7;
    private static readonly WINTER_NIGHT_OR_WEEKEND_PRICE = 0.2895;
    private static readonly WINTER_DAY_PRICE = 0.352;
    private static readonly SUMMER_NIGHT_OR_WEEKEND_PRICE = 0.373;
    private static readonly SUMMER_DAY_PRICE = 0.4355;

    public static getCurrentTransportCost(when: Date) {
        const winter = PowerPrices.isItWinterPrice(when);
        const nightOrWeekend = PowerPrices.isItNightOrWeekendPrice(when);
        if (winter) {
            if (nightOrWeekend) {
                return PowerPrices.WINTER_NIGHT_OR_WEEKEND_PRICE;
            } else {
                return PowerPrices.WINTER_DAY_PRICE;
            }
        } else {
            if (nightOrWeekend) {
                return PowerPrices.SUMMER_NIGHT_OR_WEEKEND_PRICE;
            } else {
                return PowerPrices.SUMMER_DAY_PRICE;
            }
        }
    }

    public static getCurrentPriceAfterSupport(
        price: number,
        usedThisMonthSoFar: number = 0
    ): number {
        // If we are under usage threshold and over price thtreshold, we get a discount
        let support = 0;
        if (
            usedThisMonthSoFar < PowerPrices.SUPPORT_CUTOFF_USAGE &&
            price > PowerPrices.SUPPORT_ENTRY_PRICE
        ) {
            support = (price - PowerPrices.SUPPORT_ENTRY_PRICE) * 0.9;
        }
        console.table({
            price,
            support,
            usedThisMonthSoFar,
            after: price - support,
        });
        return price - support;
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
