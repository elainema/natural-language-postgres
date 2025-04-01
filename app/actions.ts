"use server";
// 运行 SQL 查询的函数
import { sql } from "@vercel/postgres";
import { Config, configSchema, explanationSchema, Result } from '@/lib/types';
import { generateObject } from 'ai';
import { z } from 'zod';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { deepinfra } from '@ai-sdk/deepinfra';


const deepseek = createDeepSeek({
    apiKey: process.env.OPENAI_API_KEY ?? '',
});
// const model =  deepseek('deepseek-chat')
const model = deepinfra('meta-llama/Meta-Llama-3.1-405B-Instruct')

/**
 * Executes a SQL query and returns the result data
 * @param {string} query - The SQL query to execute
 * @returns {Promise<Result[]>} Array of query results
 * @throws {Error} If query is not a SELECT statement or table doesn't exist
 */
export const runGeneratedSQLQuery = async (query: string) => {
  "use server";
  // Ensure the query is a SELECT statement. Otherwise, throw an error
  if (
    !query.trim().toLowerCase().startsWith("select") ||
    query.trim().toLowerCase().includes("drop") ||
    query.trim().toLowerCase().includes("delete") ||
    query.trim().toLowerCase().includes("insert") ||
    query.trim().toLowerCase().includes("update") ||
    query.trim().toLowerCase().includes("alter") ||
    query.trim().toLowerCase().includes("truncate") ||
    query.trim().toLowerCase().includes("create") ||
    query.trim().toLowerCase().includes("grant") ||
    query.trim().toLowerCase().includes("revoke")
  ) {
    throw new Error("Only SELECT queries are allowed");
  }

  let data: any;
  try {
    data = await sql.query(query);
  } catch (e: any) {
    if (e.message.includes('relation "unicorns" does not exist')) {
      console.log(
        "Table does not exist, creating and seeding it with dummy data now...",
      );
      // throw error
      throw Error("Table does not exist");
    } else {
      throw e;
    }
  }
  console.log("data is: ", data);

  return data.rows as Result[];
};

/**
 * 根据用户的自然语言输入生成SQL查询
 * 
 * 该函数使用deepseek AI模型将自然语言转换为SQL查询。
 * 使用zod架构验证确保模型返回格式正确的SQL查询字符串。
 * 
 * @param {string} input - 用户的自然语言输入，描述他们想要查询的数据
 * @returns {Promise<string>} 返回生成的SQL查询字符串
 * @throws {Error} 如果查询生成失败则抛出错误
 */
export const generateQuery = async (input: string) => {
  'use server';
  try {
    const result = await generateObject({
      model: model,
      system: `You are a SQL (postgres) and data visualization expert. Your job is to help the user write a SQL query to retrieve the data they need. The table schema is as follows:

      unicorns (
        id SERIAL PRIMARY KEY,
        company VARCHAR(255) NOT NULL UNIQUE,
        valuation DECIMAL(10, 2) NOT NULL,
        date_joined DATE,
        country VARCHAR(255) NOT NULL,
        city VARCHAR(255) NOT NULL,
        industry VARCHAR(255) NOT NULL,
        select_investors TEXT NOT NULL
      );

      Only retrieval queries are allowed.

      For things like industry, company names and other string fields, use the ILIKE operator and convert both the search term and the field to lowercase using LOWER() function. For example: LOWER(industry) ILIKE LOWER('%search_term%').

      Note: select_investors is a comma-separated list of investors. Trim whitespace to ensure you're grouping properly. Note, some fields may be null or have only one value.
      When answering questions about a specific field, ensure you are selecting the identifying column (ie. what is Vercel's valuation would select company and valuation').

      The industries available are:
      - healthcare & life sciences
      - consumer & retail
      - financial services
      - enterprise tech
      - insurance
      - media & entertainment
      - industrials
      - health

      If the user asks for a category that is not in the list, infer based on the list above.

      Note: valuation is in billions of dollars so 10b would be 10.0.
      Note: if the user asks for a rate, return it as a decimal. For example, 0.1 would be 10%.

      If the user asks for 'over time' data, return by year.

      When searching for UK or USA, write out United Kingdom or United States respectively.

      EVERY QUERY SHOULD RETURN QUANTITATIVE DATA THAT CAN BE PLOTTED ON A CHART! There should always be at least two columns. If the user asks for a single column, return the column and the count of the column. If the user asks for a rate, return the rate as a decimal. For example, 0.1 would be 10%.`, 
      prompt: `Generate the query necessary to retrieve the data the user wants: ${input}`,
      schema: z.object({
        query: z.string(),
      }),
    });
    return result.object.query;
  } catch (e) {
    console.error(e);
    throw new Error('Failed to generate query');
  }
};

/**
 * 解释生成的SQL查询，使非技术用户能够理解查询的含义和步骤
 * 
 * 该函数使用deepseek AI模型将SQL查询分解成易于理解的步骤，
 * 并提供每个部分的解释。返回的结果包含多个解释部分，每个部分有标题和详细说明。
 * 
 * @param {string} input - 用户的原始自然语言输入
 * @param {string} sqlQuery - 需要解释的SQL查询语句
 * @returns {Promise<Array<{section: string, explanation: string}>>} 返回包含查询解释的对象数组
 * @throws {Error} 如果解释生成失败则抛出错误
 */
export const explainQuery = async (input: string, sqlQuery: string) => {
  'use server';
  try {
    const result = await generateObject({
      model: model,
      system: `You are a SQL (postgres) expert. ...`, // SYSTEM PROMPT AS ABOVE - OMITTED FOR BREVITY
      prompt: `Explain the SQL query you generated to retrieve the data the user wanted. Assume the user is not an expert in SQL. Break down the query into steps. Be concise.

      User Query:
      ${input}

      Generated SQL Query:
      ${sqlQuery}`,
      schema: explanationSchema,
      output: 'array',
    });
    return result.object;
  } catch (e) {
    console.error(e);
    throw new Error('Failed to generate query');
  }
};


/**
 * 根据查询结果和用户输入生成最适合的图表配置
 * 
 * 该函数使用deepseek AI模型分析查询结果和用户意图，
 * 生成最适合展示该数据的图表配置，包括图表类型、轴、数据系列等。
 * 生成后的配置会使用shadcn主题颜色进行覆盖，以保持视觉一致性。
 * 
 * @param {Result[]} results - SQL查询返回的数据结果数组
 * @param {string} userQuery - 用户的原始自然语言输入
 * @returns {Promise<{config: Config}>} 返回包含图表配置的对象
 * @throws {Error} 如果图表配置生成失败则抛出错误
 */
export const generateChartConfig = async (
  results: Result[],
  userQuery: string,
) => {
  'use server';

  try {
    const { object: config } = await generateObject({
      model: model,
      system: 'You are a data visualization expert.',
      prompt: `Given the following data from a SQL query result, generate the chart config that best visualises the data and answers the users query.
      For multiple groups use multi-lines.

      Here is an example complete config:
      export const chartConfig = {
        type: "pie",
        xKey: "month",
        yKeys: ["sales", "profit", "expenses"],
        colors: {
          sales: "#4CAF50",    // Green for sales
          profit: "#2196F3",   // Blue for profit
          expenses: "#F44336"  // Red for expenses
        },
        legend: true
      }

      User Query:
      ${userQuery}

      Data:
      ${JSON.stringify(results, null, 2)}`,
      schema: configSchema,
    });

    // Override with shadcn theme colors
    const colors: Record<string, string> = {};
    config.yKeys.forEach((key, index) => {
      colors[key] = `hsl(var(--chart-${index + 1}))`;
    });

    const updatedConfig = { ...config, colors };
    return { config: updatedConfig };
  } catch (e) {
    console.error(e);
    throw new Error('Failed to generate chart suggestion');
  }
};