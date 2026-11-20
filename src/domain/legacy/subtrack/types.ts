
export interface Job {
  id: string;
  date: string;
  role?: 'teacher' | 'aide';
  // undefined means 'regular' (backward compatible with jobs created before this field existed)
  employmentType?: 'regular' | 'everyday';
  className: string;
  teacher: string;
  school: string;
  town: 'Munster' | 'Highland' | string;
  dayType: 0.5 | 1;
  fromTime: string;
  toTime: string;
  hours: number;
  payRate?: number;
}

export interface Payment {
  id: string;
  date: string;
  town: string;
  amount: number;
}

export interface AppState {
  jobs: Job[];
  payments: Payment[];
}
