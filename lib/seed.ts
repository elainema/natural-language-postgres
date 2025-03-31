import { createPool } from '@vercel/postgres';
import fs from 'fs';
import csv from 'csv-parser';
import path from 'path';
import "dotenv/config"

function parseDate(dateString: string): string {
  console.log("dateString is:", dateString)
  const parts = dateString.split('/');
  if (parts.length === 3) {
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    return `${year}-${month}-${day}`;
  }
  console.warn(`Could not parse date: ${dateString}`);
  throw Error();
}

export async function seed() {
  console.log('Connecting to database using nodejs-native mode...');
  
  // 创建连接池，使用 nodejs-native 模式直接连接到数据库
  const pool = createPool({
    connectionString: process.env.POSTGRES_URL,
    mode: 'nodejs-native' // 使用本地模式，避免使用 Vercel 的代理服务
  });
  
  try {
    // 创建表
    const createTable = await pool.query(`
      CREATE TABLE IF NOT EXISTS unicorns (
        id SERIAL PRIMARY KEY,
        company VARCHAR(255) NOT NULL UNIQUE,
        valuation DECIMAL(10, 2) NOT NULL,
        date_joined DATE,
        country VARCHAR(255) NOT NULL,
        city VARCHAR(255) NOT NULL,
        industry VARCHAR(255) NOT NULL,
        select_investors TEXT NOT NULL
      );
    `);
    
    console.log('Successfully connected to database');

  console.log(`Created "unicorns" table`);

  const results: any[] = [];
  const csvFilePath = path.join(process.cwd(), 'unicorns.csv');

  await new Promise((resolve, reject) => {
    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', resolve)
      .on('error', reject);
  });

  for (const row of results) {
    try {
      console.log("Processing row:", row.Company, "Date:", row['Date Joined']);
      const formattedDate = parseDate(row['Date Joined']);
      
      await pool.query(
        `INSERT INTO unicorns (company, valuation, date_joined, country, city, industry, select_investors)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (company) DO NOTHING;`,
        [
          row.Company,
          parseFloat(row['Valuation ($B)'].replace('$', '').replace(',', '')),
          formattedDate,
          row.Country,
          row.City,
          row.Industry,
          row['Select Investors']
        ]
      );
      
      console.log(`Successfully inserted: ${row.Company}`);
    } catch (error) {
      console.error(`Error inserting row: ${row.Company}`, error);
    }
  }

    console.log(`Successfully seeded ${results.length} unicorns`);
    
    return {
      unicorns: results,
    };
  } catch (error) {
    console.error('Database operation failed:', error);
    throw error;
  }
}


seed().catch(console.error);