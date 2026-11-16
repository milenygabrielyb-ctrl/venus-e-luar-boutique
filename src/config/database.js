/**
 * VÊNUS & LUAR BOUTIQUE - INFRAESTRUTURA DE BANCO DE DADOS RELACIONAL
 * 
 * Implementação nativa usando `node:sqlite` (Node.js 26+ DatabaseSync)
 * Suporta concorrência multi-processo (Porta 3000 E-commerce e Porta 3001 PDV)
 * Garantia ACID, modo WAL e timeout contra bloqueios concorrentes.
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const STORAGE_DIR = path.join(__dirname, '..', '..', 'storage');
const DB_FILE = path.join(STORAGE_DIR, 'database.sqlite');

// Garantir diretórios de armazenamento
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

const XML_INBOUND = path.join(STORAGE_DIR, 'xml', 'inbound');
const XML_AUTH = path.join(STORAGE_DIR, 'xml', 'authorized');
const XML_CONTINGENCY = path.join(STORAGE_DIR, 'xml', 'contingency');
const PRINTS_DIR = path.join(STORAGE_DIR, 'prints');

[XML_INBOUND, XML_AUTH, XML_CONTINGENCY, PRINTS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

let dbInstance = null;

function getDb() {
  if (!dbInstance) {
    dbInstance = new DatabaseSync(DB_FILE);
    
    // Concorrência obrigatória para múltiplos processos Node.js simultâneos
    dbInstance.exec('PRAGMA journal_mode = WAL;');
    dbInstance.exec('PRAGMA busy_timeout = 5000;');
    dbInstance.exec('PRAGMA foreign_keys = ON;');
  }
  return dbInstance;
}

/**
 * Executa uma consulta SQL retornando todas as linhas
 */
function query(sql, params = []) {
  const db = getDb();
  const stmt = db.prepare(sql);
  return stmt.all(...params);
}

/**
 * Executa uma consulta SQL retornando a primeira linha
 */
function queryOne(sql, params = []) {
  const db = getDb();
  const stmt = db.prepare(sql);
  return stmt.get(...params);
}

/**
 * Executa um comando SQL (INSERT, UPDATE, DELETE)
 */
function execute(sql, params = []) {
  const db = getDb();
  const stmt = db.prepare(sql);
  return stmt.run(...params);
}

/**
 * Executa múltiplas instruções SQL (DDL, scripts)
 */
function execScript(sqlScript) {
  const db = getDb();
  db.exec(sqlScript);
}

let savepointCounter = 0;

/**
 * Executa uma operação dentro de uma transação com commit/rollback
 * Suporta transações aninhadas através de SAVEPOINTs nativos do SQLite.
 */
function transaction(fn) {
  const db = getDb();
  const spName = 'sp_' + (++savepointCounter);
  db.exec(`SAVEPOINT ${spName};`);
  try {
    const result = fn(db);
    db.exec(`RELEASE SAVEPOINT ${spName};`);
    return result;
  } catch (err) {
    try {
      db.exec(`ROLLBACK TO SAVEPOINT ${spName};`);
    } catch (rbErr) {
      // Falha ao dar rollback secundário
    }
    throw err;
  }
}

module.exports = {
  getDb,
  query,
  queryOne,
  execute,
  execScript,
  transaction,
  STORAGE_DIR,
  DB_FILE
};
