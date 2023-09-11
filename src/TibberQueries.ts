export const usageQuery = `{
  viewer {
    homes {
      id
      consumption(resolution: HOURLY, last: HOURS_TO_GET) {
        nodes {
          from
          to
          unitPrice
          unitPriceVAT
          consumption
        }
      }
      production(resolution: HOURLY, last: HOURS_TO_GET) {
        nodes {
          from
          to
          unitPrice
          unitPriceVAT
          production
        }
      }
      currentSubscription {
        status
        priceInfo {
          today {
            total
            energy
            tax
            startsAt
          }
          current {
            total
            energy
            tax
            startsAt
          }
        }
      }
    }
  }
}`;

export interface usageQueryResponse {
    viewer: {
        homes: {
            id: string;
            consumption: {
                nodes: {
                    from: string;
                    to: string;
                    unitPrice: number;
                    unitPriceVAT: number;
                    consumption: number;
                }[];
            };
            production: {
                nodes: {
                    from: string;
                    to: string;
                    unitPrice: number;
                    unitPriceVAT: number;
                    production: number;
                }[];
            };
            currentSubscription: {
                status: string;
                priceInfo: {
                    today: {
                        total: number;
                        energy: number;
                        tax: number;
                        startsAt: string;
                    }[];
                    current: {
                        total: number;
                        energy: number;
                        tax: number;
                        startsAt: string;
                    };
                };
            };
        }[];
    };
}
