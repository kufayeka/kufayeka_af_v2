import { Body, Controller, Get, Post } from "@nestjs/common";
import { DbService } from "./db.service";

@Controller("db")
export class DbController {
  constructor(private readonly dbService: DbService) {}

  @Get("config")
  getConfig() {
    return this.dbService.getConfig();
  }

  @Post("test-connection")
  testConnection() {
    return this.dbService.testConnection();
  }

  @Post("sql-test")
  sqlTest(@Body() body: { sql?: unknown }) {
    return this.dbService.executeSql(body || {});
  }
}
