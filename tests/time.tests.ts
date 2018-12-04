import {isInTimeInterval, parseTime, getDuration} from '../src/utils/time';

test('Time interval', () => {
    expect(isInTimeInterval(new Date(2018, 11, 4, 10), '9:00', '12:00')).toBe(true);
    expect(isInTimeInterval(new Date(2018, 11, 4, 10), '9:00', '10:00')).toBe(false);
    expect(isInTimeInterval(new Date(2018, 11, 4, 10), '9:00', '10:01')).toBe(true);
    expect(isInTimeInterval(new Date(2018, 11, 4, 10), '18:00', '12:00')).toBe(true);
    expect(isInTimeInterval(new Date(2018, 11, 4, 10), '18:00', '9:00')).toBe(false);
});

test('Time parse', () => {
    expect(parseTime('10:30')).toEqual([10, 30]);
    expect(parseTime('10:30AM')).toEqual([10, 30]);
    expect(parseTime('10:30 a.m.')).toEqual([10, 30]);
    expect(parseTime('10:30PM')).toEqual([22, 30]);
    expect(parseTime('10:30 p.m.')).toEqual([22, 30]);
    expect(parseTime('0:30')).toEqual([0, 30]);
    expect(parseTime('12:30am')).toEqual([0, 30]);
    expect(parseTime('12:30pm')).toEqual([12, 30]);
});

test('Duration', () => {
    expect(getDuration({
        seconds: 48,
        minutes: 24,
        hours: 8,
        days: 3
    })).toEqual(289488000);
});
