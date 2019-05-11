// Core
import { useEffect } from 'react';
import useLocalState from '../hooks/useLocalState';
import { sortBy } from 'lodash';
import Location from '../types/location';
import { DateTime } from 'luxon';
import { statusFromTimeStrings, timeStringToDateTime } from './dateTimeHelpers';

function fetchLocationsFromGSheets({
  sheetId,
  sheetName,
  apiKey
}: {
  sheetId: string;
  sheetName: string;
  apiKey: string;
}): Location[] {
  if (!sheetId || !sheetName || !apiKey) {
    return [];
  }

  // Stateful object to store locations (with caching in localStorage)
  const [locations, setLocations] = useLocalState<Location[]>([], 'locations-list-cache');

  // URL format that returns Google sheet as JSON data
  const jsonUrl =
    'https://sheets.googleapis.com/v4/spreadsheets/' +
    sheetId +
    '/values/' +
    sheetName +
    '/?key=' +
    apiKey;

  const fetchData = async () => {
    try {
      // Begin benchmark for fetch time
      const fetchT0 = performance.now();

      // Fetch data
      const response = await fetch(jsonUrl);
      const data = await response.json();

      // Print to the console how long the fetch took
      const fetchT1 = performance.now();
      console.log('Fetched Google Sheet data in ' + Math.round(fetchT1 - fetchT0) + 'ms');

      // Begin benchmark for transform time
      const transformT0 = performance.now();

      // Headers are the first row in the document
      const headers = data.values[0];

      // Initialize array to store formatted data
      let dataList: {}[] = [];

      // Loop through each row, attach headers, and push the new object to `dataList` array
      data.values.forEach((rowData: {}[], rowIndex: number) => {
        // Don't need headers here, so return early first row
        if (rowIndex === 0) return;

        // Object to store the row's formatted data
        let rowObject: any = {};

        // Loop through the headers and assign as a keys to each row cell's value
        headers.forEach((header: string, headerIndex: number) => {
          const value = rowData[headerIndex];
          rowObject[header] = formatCellData(value, header);
        });

        // If row doesn't include name, lat/lng, or start/end dates, toss it out
        if (
          !rowObject.name ||
          !rowObject.lat ||
          !rowObject.lng ||
          !rowObject.startDate ||
          !rowObject.endDate
        )
          return;

        // Data Transformations
        rowObject.servesBreakfast = !!rowObject.breakfastStart && !!rowObject.breakfastEnd;
        rowObject.servesLunch = !!rowObject.lunchStart && !!rowObject.lunchEnd;
        rowObject.servesSnack = !!rowObject.snackStart && !!rowObject.snackEnd;
        rowObject.servesDinner = !!rowObject.dinnerStart && !!rowObject.dinnerEnd;

        // Get status
        const now = DateTime.local();
        const startDate = DateTime.fromJSDate(rowObject.startDate);
        const endDate = DateTime.fromJSDate(rowObject.endDate).endOf('day');
        if (now < startDate) {
          // Before open
          rowObject.status = 'before-start';
        } else if (now > endDate) {
          // After close
          rowObject.status = 'after-end';
        } else {
          // Check if serving meals this day of the week
          // 1 = Monday, 2 = Tuesday, 3 = Wednesday, etc
          const openDays: boolean[] = [];
          openDays[1] = rowObject.monday;
          openDays[2] = rowObject.tuesday;
          openDays[3] = rowObject.wednesday;
          openDays[4] = rowObject.thursday;
          openDays[5] = rowObject.friday;
          openDays[6] = rowObject.saturday;
          openDays[7] = rowObject.sunday;
          const meals = ['breakfast', 'lunch', 'snack', 'dinner'];
          if (openDays[now.weekday]) {
            // Since it's open sometime today, loop through and check status of each meal
            meals.some(meal => {
              const mealStatus = statusFromTimeStrings(
                rowObject[meal + 'Start'],
                rowObject[meal + 'End']
              );
              // Assign appropriate status of location if set
              if (mealStatus) {
                rowObject.status = mealStatus;
                // Set appropriate current meal and comparison time
                rowObject.currentMeal = meal;
                rowObject.currentMealUntil =
                  mealStatus === 'open-soon' ? rowObject[meal + 'Start'] : rowObject[meal + 'End'];
              } else {
                // Figure out if this meal is next
                const startString = rowObject[meal + 'Start'];
                if (startString) {
                  const startTime = timeStringToDateTime(startString);
                  const isUpcoming = startTime > now;
                  if (
                    isUpcoming && // is later today
                    (!rowObject.nextMealDate ||
                      startTime < DateTime.fromJSDate(rowObject.nextMealDate)) // is soonest upcoming today
                  ) {
                    // Print this time to nextMealStarts
                    rowObject.nextMealDate = startTime.toJSDate();
                  }
                }
              }
              // Exit 'some' loop if true
              return !!mealStatus;
            });
          }
          // No status found, so we're closed!
          if (!rowObject.status) {
            rowObject.status = 'closed';
            // XXX TODO
            // Need to find next open date
            rowObject.nextMealDate = DateTime.local()
              .plus({ day: 2 })
              .toJSDate();
          }
        }
        rowObject.status; // Finish status

        // Push `row` object into `dataList` array
        dataList.push(rowObject);
      });

      // Print to the console how long transforming/formatting took
      const transformT1 = performance.now();
      console.log('Formatted data in ' + Math.round(transformT1 - transformT0) + 'ms');

      // Return formatted data sorted by name at default
      return sortBy(dataList, ['name']);
    } catch (error) {
      // If error, print to console and return empty array
      console.error('Error fetching and formatting Google Sheets data...', error);
      return [];
    }
  };

  // Fetch Data on load
  useEffect(() => {
    fetchData().then(result => {
      setLocations(result);
    });
  }, []);

  return locations || [];
}

export default fetchLocationsFromGSheets;

function formatCellData(data: any, key: string) {
  let returnValue = data;
  // Convert boolean strings to natives
  returnValue = returnValue === 'TRUE' ? true : returnValue;
  returnValue = returnValue === 'FALSE' ? false : returnValue;

  // Trim strings then nullify if empty
  if (typeof returnValue === 'string') {
    returnValue = returnValue.trim();
    returnValue = !!returnValue ? returnValue : null;
  }

  // If key has "date" anywhere in the name
  // try to convert to a javascript date
  if (typeof key === 'string' && key.search(/date/i) > 0) {
    const date = new Date(data);
    // Only assign value if converted to valid date
    returnValue = !!date && !isNaN(date.getTime()) ? date : returnValue;
  }

  // Try to convert lat + lng to numbers
  if (key === 'lat' || key === 'lng') {
    returnValue = parseFloat(data);
  }

  return returnValue;
}
