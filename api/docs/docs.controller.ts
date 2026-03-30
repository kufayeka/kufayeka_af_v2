import { Controller, Get, Redirect } from "@nestjs/common";

@Controller()
export class DocsController {
  @Get("openapi")
  @Redirect("/docs", 302)
  openApiPage() {
    return;
  }

  @Get("openapi.json")
  @Redirect("/docs-json", 302)
  openApiJson() {
    return;
  }
}
