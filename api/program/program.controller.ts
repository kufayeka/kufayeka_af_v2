import { Controller, Get, Post } from "@nestjs/common";
import { ProgramService } from "./program.service";

@Controller("program")
export class ProgramController {
  constructor(private readonly programService: ProgramService) {}

  @Get("status")
  getStatus() {
    return this.programService.getStatus();
  }

  @Post("reload")
  async reloadFromDisk() {
    return await this.programService.reloadFromDisk();
  }
}
