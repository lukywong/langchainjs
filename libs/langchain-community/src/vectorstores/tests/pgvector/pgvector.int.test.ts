import { expect, test } from "@jest/globals";
import pg, { PoolConfig } from "pg";
import { OpenAIEmbeddings } from "@langchain/openai";
import { PGVectorStore, PGVectorStoreArgs } from "../../pgvector.js";

describe("PGVectorStore", () => {
  let pgvectorVectorStore: PGVectorStore;
  const tableName = "testlangchain";

  beforeAll(async () => {
    const config = {
      postgresConnectionOptions: {
        type: "postgres",
        host: "127.0.0.1",
        port: 5433,
        user: "myuser",
        password: "ChangeMe",
        database: "api",
      } as PoolConfig,
      tableName: "testlangchain",
      // collectionTableName: "langchain_pg_collection",
      // collectionName: "langchain",
      columns: {
        idColumnName: "id",
        vectorColumnName: "vector",
        contentColumnName: "content",
        metadataColumnName: "metadata",
      },
    };

    pgvectorVectorStore = await PGVectorStore.initialize(
      new OpenAIEmbeddings(),
      config
    );
  });

  afterEach(async () => {
    // Drop table, then recreate it for the next test.
    await pgvectorVectorStore.pool.query(`DROP TABLE "${tableName}"`);
    await pgvectorVectorStore.ensureTableInDatabase();
  });

  afterAll(async () => {
    await pgvectorVectorStore.end();
  });

  test("Test embeddings creation", async () => {
    const documents = [
      {
        pageContent: "hello",
        metadata: { a: 1 },
      },
      {
        pageContent: "Cat drinks milk",
        metadata: { a: 2 },
      },
      { pageContent: "hi", metadata: { a: 1 } },
    ];
    await pgvectorVectorStore.addDocuments(documents);
    const results = await pgvectorVectorStore.similaritySearch("hello", 2, {
      a: 2,
    });

    expect(results).toHaveLength(1);
    expect(results[0].pageContent).toEqual("Cat drinks milk");
  });

  test("PGvector can save documents with a list greater than default chunk size", async () => {
    try {
      // Extract the default chunk size and add one.
      const docsToGenerate = pgvectorVectorStore.chunkSize + 1;
      const documents = [];
      for (let i = 1; i <= docsToGenerate; i += 1) {
        documents.push({ pageContent: "Lorem Ipsum", metadata: { a: i } });
      }
      await pgvectorVectorStore.addDocuments(documents);

      // Query the table to check the number of rows
      const result = await pgvectorVectorStore.pool.query(
        `SELECT COUNT(*) FROM "${tableName}"`
      );
      const rowCount = parseInt(result.rows[0].count, 10);
      // Check if the number of rows is equal to the number of documents added
      expect(rowCount).toEqual(docsToGenerate);
    } catch (e) {
      console.error("Error: ", e);
      throw e;
    }
  });

  test("PGvector can save documents with ids", async () => {
    const id1 = "d8e70e98-19ab-4438-9c14-4bb2bb21a1f9";
    const id2 = "2bbb4b73-efec-4d5e-80ea-df94a4ed3aa3";

    const documents = [
      { pageContent: "Lorem Ipsum", metadata: { a: 1 } },
      { pageContent: "Lorem Ipsum", metadata: { a: 2 } },
    ];

    await pgvectorVectorStore.addDocuments(documents, { ids: [id1, id2] });

    const result = await pgvectorVectorStore.pool.query(
      `SELECT id FROM "${tableName}" WHERE id = $1`,
      [id1]
    );

    expect(result.rowCount).toEqual(1);
  });

  test("PGvector supports different filter types", async () => {
    const documents = [
      { pageContent: "Lorem Ipsum", metadata: { a: 100 } },
      { pageContent: "Lorem Ipsum", metadata: { a: 200 } },
      { pageContent: "Lorem Ipsum", metadata: { a: 300 } },
    ];

    await pgvectorVectorStore.addDocuments(documents);

    const result = await pgvectorVectorStore.similaritySearch("hello", 2, {
      a: {
        in: [100, 300],
      },
    });

    expect(result.length).toEqual(2);
    expect(result).toEqual([
      { pageContent: "Lorem Ipsum", metadata: { a: 100 } },
      { pageContent: "Lorem Ipsum", metadata: { a: 300 } },
    ]);

    const result2 = await pgvectorVectorStore.similaritySearch("hello", 2, {
      a: 200,
    });
    expect(result2.length).toEqual(1);
    expect(result2).toEqual([
      { pageContent: "Lorem Ipsum", metadata: { a: 200 } },
    ]);

    const result3 = await pgvectorVectorStore.similaritySearch("hello", 3);

    expect(result3.length).toEqual(3);
  });

  test("PGvector can delete document by id", async () => {
    try {
      const documents = [
        { pageContent: "Lorem Ipsum", metadata: { a: 1 } },
        { pageContent: "Lorem Ipsum", metadata: { a: 2 } },
        { pageContent: "Lorem Ipsum", metadata: { a: 3 } },
      ];
      await pgvectorVectorStore.addDocuments(documents);

      const result = await pgvectorVectorStore.pool.query(
        `SELECT id FROM "${tableName}"`
      );

      const initialIds = result.rows.map((row) => row.id);
      const firstIdToDelete = initialIds[0];
      const secondIdToDelete = initialIds[1];
      const idToKeep = initialIds[2];

      await pgvectorVectorStore.delete({
        ids: [firstIdToDelete, secondIdToDelete],
      });

      const result2 = await pgvectorVectorStore.pool.query(
        `SELECT id FROM "${tableName}"`
      );

      // Only one row should be left
      expect(result2.rowCount).toEqual(1);

      // The deleted ids should not be in the result
      const idsAfterDelete = result2.rows.map((row) => row.id);
      expect(idsAfterDelete).not.toContain(firstIdToDelete);
      expect(idsAfterDelete).not.toContain(secondIdToDelete);

      expect(idsAfterDelete).toContain(idToKeep);
    } catch (e) {
      console.error("Error: ", e);
      throw e;
    }
  });

  test("PGvector can delete document by metadata", async () => {
    try {
      const documents = [
        { pageContent: "Lorem Ipsum", metadata: { a: 1, b: 1 } },
        { pageContent: "Lorem Ipsum", metadata: { a: 2, b: 1 } },
        { pageContent: "Lorem Ipsum", metadata: { a: 1, c: 1 } },
      ];
      await pgvectorVectorStore.addDocuments(documents);
      const result = await pgvectorVectorStore.pool.query(
        `SELECT id FROM "${tableName}"`
      );

      const initialIds = result.rows.map((row) => row.id);

      // Filter Matches 1st document
      await pgvectorVectorStore.delete({ filter: { a: 1, b: 1 } });

      const result2 = await pgvectorVectorStore.pool.query(
        `SELECT id FROM "${tableName}"`
      );

      // Two rows should be left
      expect(result2.rowCount).toEqual(2);

      const idsAfterDelete = result2.rows.map((row) => row.id);

      // The document with matching metadata should not be in the database
      expect(idsAfterDelete).not.toContainEqual(initialIds[0]);

      // All other documents should still be in database
      expect(idsAfterDelete).toContainEqual(initialIds[1]);
      expect(idsAfterDelete).toContainEqual(initialIds[2]);
    } catch (e) {
      console.error("Error: ", e);
      throw e;
    }
  });
});

describe.skip("PGVectorStore with collection", () => {
  let pgvectorVectorStore: PGVectorStore;
  const tableName = "testlangchain_collection";
  const collectionTableName = "langchain_pg_collection";

  beforeAll(async () => {
    const config = {
      postgresConnectionOptions: {
        type: "postgres",
        host: "127.0.0.1",
        port: 5433,
        user: "myuser",
        password: "ChangeMe",
        database: "api",
      } as PoolConfig,
      tableName,
      collectionTableName,
      collectionName: "langchain",
      columns: {
        idColumnName: "id",
        vectorColumnName: "vector",
        contentColumnName: "content",
        metadataColumnName: "metadata",
      },
    };

    pgvectorVectorStore = await PGVectorStore.initialize(
      new OpenAIEmbeddings(),
      config
    );
  });

  afterEach(async () => {
    // Drop table, then recreate it for the next test.
    await pgvectorVectorStore.pool.query(`DROP TABLE "${tableName}"`);
    await pgvectorVectorStore.pool.query(
      `DROP TABLE ${pgvectorVectorStore.computedCollectionTableName}`
    );
    await pgvectorVectorStore.ensureTableInDatabase();
    await pgvectorVectorStore.ensureCollectionTableInDatabase();
  });

  afterAll(async () => {
    await pgvectorVectorStore.end();
  });

  test("Test embeddings creation", async () => {
    const documents = [
      {
        pageContent: "hello",
        metadata: { a: 1 },
      },
      {
        pageContent: "Cat drinks milk",
        metadata: { a: 2 },
      },
      { pageContent: "hi", metadata: { a: 1 } },
    ];
    await pgvectorVectorStore.addDocuments(documents);
    const results = await pgvectorVectorStore.similaritySearch("hello", 2, {
      a: 2,
    });

    expect(results).toHaveLength(1);
    expect(results[0].pageContent).toEqual("Cat drinks milk");
  });

  test("PGvector can save documents with a list greater than default chunk size", async () => {
    try {
      // Extract the default chunk size and add one.
      const docsToGenerate = pgvectorVectorStore.chunkSize + 1;
      const documents = [];
      for (let i = 1; i <= docsToGenerate; i += 1) {
        documents.push({ pageContent: "Lorem Ipsum", metadata: { a: i } });
      }
      await pgvectorVectorStore.addDocuments(documents);

      // Query the table to check the number of rows
      const result = await pgvectorVectorStore.pool.query(
        `SELECT COUNT(*) FROM "${tableName}"`
      );
      const rowCount = parseInt(result.rows[0].count, 10);
      // Check if the number of rows is equal to the number of documents added
      expect(rowCount).toEqual(docsToGenerate);
    } catch (e) {
      console.error("Error: ", e);
      throw e;
    }
  });

  test("PGvector can save documents with ids", async () => {
    const id1 = "d8e70e98-19ab-4438-9c14-4bb2bb21a1f9";
    const id2 = "2bbb4b73-efec-4d5e-80ea-df94a4ed3aa3";

    const documents = [
      { pageContent: "Lorem Ipsum", metadata: { a: 1 } },
      { pageContent: "Lorem Ipsum", metadata: { a: 2 } },
    ];

    await pgvectorVectorStore.addDocuments(documents, { ids: [id1, id2] });

    const result = await pgvectorVectorStore.pool.query(
      `SELECT id FROM "${tableName}" WHERE id = $1`,
      [id1]
    );

    expect(result.rowCount).toEqual(1);
  });

  test("PGvector supports different filter types", async () => {
    const documents = [
      { pageContent: "Lorem Ipsum", metadata: { a: 100 } },
      { pageContent: "Lorem Ipsum", metadata: { a: 200 } },
      { pageContent: "Lorem Ipsum", metadata: { a: 300 } },
    ];

    await pgvectorVectorStore.addDocuments(documents);

    const result = await pgvectorVectorStore.similaritySearch("hello", 2, {
      a: {
        in: [100, 300],
      },
    });

    expect(result.length).toEqual(2);
    expect(result).toEqual([
      { pageContent: "Lorem Ipsum", metadata: { a: 100 } },
      { pageContent: "Lorem Ipsum", metadata: { a: 300 } },
    ]);

    const result2 = await pgvectorVectorStore.similaritySearch("hello", 2, {
      a: 200,
    });
    expect(result2.length).toEqual(1);
    expect(result2).toEqual([
      { pageContent: "Lorem Ipsum", metadata: { a: 200 } },
    ]);

    const result3 = await pgvectorVectorStore.similaritySearch("hello", 3);

    expect(result3.length).toEqual(3);
  });

  test("PGvector can delete document by id", async () => {
    try {
      const documents = [
        { pageContent: "Lorem Ipsum", metadata: { a: 1 } },
        { pageContent: "Lorem Ipsum", metadata: { a: 2 } },
        { pageContent: "Lorem Ipsum", metadata: { a: 3 } },
      ];
      await pgvectorVectorStore.addDocuments(documents);

      const result = await pgvectorVectorStore.pool.query(
        `SELECT id FROM "${tableName}"`
      );

      const initialIds = result.rows.map((row) => row.id);
      const firstIdToDelete = initialIds[0];
      const secondIdToDelete = initialIds[1];
      const idToKeep = initialIds[2];

      await pgvectorVectorStore.delete({
        ids: [firstIdToDelete, secondIdToDelete],
      });

      const result2 = await pgvectorVectorStore.pool.query(
        `SELECT id FROM "${tableName}"`
      );

      // Only one row should be left
      expect(result2.rowCount).toEqual(1);

      // The deleted ids should not be in the result
      const idsAfterDelete = result2.rows.map((row) => row.id);
      expect(idsAfterDelete).not.toContain(firstIdToDelete);
      expect(idsAfterDelete).not.toContain(secondIdToDelete);

      expect(idsAfterDelete).toContain(idToKeep);
    } catch (e) {
      console.error("Error: ", e);
      throw e;
    }
  });

  test("PGvector can delete document by metadata", async () => {
    try {
      const documents = [
        { pageContent: "Lorem Ipsum", metadata: { a: 1, b: 1 } },
        { pageContent: "Lorem Ipsum", metadata: { a: 2, b: 1 } },
        { pageContent: "Lorem Ipsum", metadata: { a: 1, c: 1 } },
      ];
      await pgvectorVectorStore.addDocuments(documents);
      const result = await pgvectorVectorStore.pool.query(
        `SELECT id FROM "${tableName}"`
      );

      const initialIds = result.rows.map((row) => row.id);

      // Filter Matches 1st document
      await pgvectorVectorStore.delete({ filter: { a: 1, b: 1 } });

      const result2 = await pgvectorVectorStore.pool.query(
        `SELECT id FROM "${tableName}"`
      );

      // Two rows should be left
      expect(result2.rowCount).toEqual(2);

      const idsAfterDelete = result2.rows.map((row) => row.id);

      // The document with matching metadata should not be in the database
      expect(idsAfterDelete).not.toContainEqual(initialIds[0]);

      // All other documents should still be in database
      expect(idsAfterDelete).toContainEqual(initialIds[1]);
      expect(idsAfterDelete).toContainEqual(initialIds[2]);
    } catch (e) {
      console.error("Error: ", e);
      throw e;
    }
  });
});

describe.skip("PGVectorStore with schema", () => {
  let pgvectorVectorStore: PGVectorStore;
  const tableName = "testlangchain_schema";
  const schema = "test_schema";
  const collectionTableName = "langchain_pg_collection_schema";
  let computedTableName: string;
  let computedCollectionTableName: string;
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({
      host: "127.0.0.1",
      port: 5433,
      user: "myuser",
      password: "ChangeMe",
      database: "api",
    });

    const config: PGVectorStoreArgs = {
      pool,
      tableName,
      columns: {
        idColumnName: "id",
        vectorColumnName: "vector",
        contentColumnName: "content",
        metadataColumnName: "metadata",
      },
      collectionTableName,
      collectionName: "langchain",
      schemaName: schema,
    };

    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);

    pgvectorVectorStore = await PGVectorStore.initialize(
      new OpenAIEmbeddings(),
      config
    );
    computedTableName = pgvectorVectorStore.computedTableName;
    computedCollectionTableName =
      pgvectorVectorStore.computedCollectionTableName;
  });

  afterEach(async () => {
    // Drop table, then recreate it for the next test.
    await pgvectorVectorStore.pool.query(`DROP TABLE ${computedTableName}`);
    await pgvectorVectorStore.pool.query(
      `DROP TABLE ${computedCollectionTableName}`
    );
    await pgvectorVectorStore.ensureTableInDatabase();
    await pgvectorVectorStore.ensureCollectionTableInDatabase();
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pgvectorVectorStore.end();
  });

  test("Test table creation with schema", async () => {
    const result = await pgvectorVectorStore.pool.query(
      `SELECT table_schema FROM information_schema.tables WHERE table_name = '${tableName}' AND table_schema = '${schema}'`
    );

    expect(result.rowCount).toEqual(1);

    const result2 = await pgvectorVectorStore.pool.query(
      `SELECT table_schema FROM information_schema.tables WHERE table_name = '${collectionTableName}' AND table_schema = '${schema}'`
    );

    expect(result2.rowCount).toEqual(1);
  });

  test("Test embeddings creation", async () => {
    const documents = [
      {
        pageContent: "hello",
        metadata: { a: 1 },
      },
      {
        pageContent: "Cat drinks milk",
        metadata: { a: 2 },
      },
      { pageContent: "hi", metadata: { a: 1 } },
    ];
    await pgvectorVectorStore.addDocuments(documents);
    const results = await pgvectorVectorStore.similaritySearch("hello", 2, {
      a: 2,
    });

    expect(results).toHaveLength(1);
    expect(results[0].pageContent).toEqual("Cat drinks milk");
  });

  test("PGvector can save documents with a list greater than default chunk size", async () => {
    try {
      // Extract the default chunk size and add one.
      const docsToGenerate = pgvectorVectorStore.chunkSize + 1;
      const documents = [];
      for (let i = 1; i <= docsToGenerate; i += 1) {
        documents.push({ pageContent: "Lorem Ipsum", metadata: { a: i } });
      }
      await pgvectorVectorStore.addDocuments(documents);

      // Query the table to check the number of rows
      const result = await pgvectorVectorStore.pool.query(
        `SELECT COUNT(*) FROM ${computedTableName}`
      );
      const rowCount = parseInt(result.rows[0].count, 10);
      // Check if the number of rows is equal to the number of documents added
      expect(rowCount).toEqual(docsToGenerate);
    } catch (e) {
      console.error("Error: ", e);
      throw e;
    }
  });

  test("PGvector can save documents with ids", async () => {
    const id1 = "d8e70e98-19ab-4438-9c14-4bb2bb21a1f9";
    const id2 = "2bbb4b73-efec-4d5e-80ea-df94a4ed3aa3";

    const documents = [
      { pageContent: "Lorem Ipsum", metadata: { a: 1 } },
      { pageContent: "Lorem Ipsum", metadata: { a: 2 } },
    ];

    await pgvectorVectorStore.addDocuments(documents, { ids: [id1, id2] });

    const result = await pgvectorVectorStore.pool.query(
      `SELECT id FROM ${computedTableName} WHERE id = $1`,
      [id1]
    );

    expect(result.rowCount).toEqual(1);
  });

  test("PGvector supports different filter types", async () => {
    const documents = [
      { pageContent: "Lorem Ipsum", metadata: { a: 100 } },
      { pageContent: "Lorem Ipsum", metadata: { a: 200 } },
      { pageContent: "Lorem Ipsum", metadata: { a: 300 } },
    ];

    await pgvectorVectorStore.addDocuments(documents);

    const result = await pgvectorVectorStore.similaritySearch("hello", 2, {
      a: {
        in: [100, 300],
      },
    });

    expect(result.length).toEqual(2);
    expect(result).toEqual([
      { pageContent: "Lorem Ipsum", metadata: { a: 100 } },
      { pageContent: "Lorem Ipsum", metadata: { a: 300 } },
    ]);

    const result2 = await pgvectorVectorStore.similaritySearch("hello", 2, {
      a: 200,
    });
    expect(result2.length).toEqual(1);
    expect(result2).toEqual([
      { pageContent: "Lorem Ipsum", metadata: { a: 200 } },
    ]);

    const result3 = await pgvectorVectorStore.similaritySearch("hello", 3);

    expect(result3.length).toEqual(3);
  });

  test("PGvector can delete document by id", async () => {
    try {
      const documents = [
        { pageContent: "Lorem Ipsum", metadata: { a: 1 } },
        { pageContent: "Lorem Ipsum", metadata: { a: 2 } },
        { pageContent: "Lorem Ipsum", metadata: { a: 3 } },
      ];
      await pgvectorVectorStore.addDocuments(documents);

      const result = await pgvectorVectorStore.pool.query(
        `SELECT id FROM ${computedTableName}`
      );

      const initialIds = result.rows.map((row) => row.id);
      const firstIdToDelete = initialIds[0];
      const secondIdToDelete = initialIds[1];
      const idToKeep = initialIds[2];

      await pgvectorVectorStore.delete({
        ids: [firstIdToDelete, secondIdToDelete],
      });

      const result2 = await pgvectorVectorStore.pool.query(
        `SELECT id FROM ${computedTableName}`
      );

      // Only one row should be left
      expect(result2.rowCount).toEqual(1);

      // The deleted ids should not be in the result
      const idsAfterDelete = result2.rows.map((row) => row.id);
      expect(idsAfterDelete).not.toContain(firstIdToDelete);
      expect(idsAfterDelete).not.toContain(secondIdToDelete);

      expect(idsAfterDelete).toContain(idToKeep);
    } catch (e) {
      console.error("Error: ", e);
      throw e;
    }
  });

  test("PGvector can delete document by metadata", async () => {
    try {
      const documents = [
        { pageContent: "Lorem Ipsum", metadata: { a: 1, b: 1 } },
        { pageContent: "Lorem Ipsum", metadata: { a: 2, b: 1 } },
        { pageContent: "Lorem Ipsum", metadata: { a: 1, c: 1 } },
      ];
      await pgvectorVectorStore.addDocuments(documents);
      const result = await pgvectorVectorStore.pool.query(
        `SELECT id FROM ${computedTableName}`
      );

      const initialIds = result.rows.map((row) => row.id);

      // Filter Matches 1st document
      await pgvectorVectorStore.delete({ filter: { a: 1, b: 1 } });

      const result2 = await pgvectorVectorStore.pool.query(
        `SELECT id FROM ${computedTableName}`
      );

      // Two rows should be left
      expect(result2.rowCount).toEqual(2);

      const idsAfterDelete = result2.rows.map((row) => row.id);

      // The document with matching metadata should not be in the database
      expect(idsAfterDelete).not.toContainEqual(initialIds[0]);

      // All other documents should still be in database
      expect(idsAfterDelete).toContainEqual(initialIds[1]);
      expect(idsAfterDelete).toContainEqual(initialIds[2]);
    } catch (e) {
      console.error("Error: ", e);
      throw e;
    }
  });
});
