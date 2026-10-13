import { Link } from 'react-router-dom';

// MINUTA. Texto preparado a partir da LGPD e de normas do CFP, pendente de
// revisão por advogado antes de uso comercial (ver docs/PENDENCIAS.md).
export function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 leading-relaxed">
      <Link to="/" className="font-bold text-anil">Voltar</Link>
      <h1 className="mb-2 mt-4 text-[28px] font-bold">Termos de uso e política de privacidade</h1>
      <p className="mb-6 rounded-lg bg-ocre-fundo px-4 py-3 text-ocre">Minuta em revisão jurídica. Versão de desenvolvimento.</p>

      <h2 className="mt-6 text-xl font-bold">1. O serviço</h2>
      <p>Ferramenta de gestão para psicólogas: agenda, cadastro de pacientes, prontuário, documentos e controle financeiro. O serviço não presta atendimento psicológico, não processa pagamentos e não emite notas fiscais ou recibos oficiais.</p>

      <h2 className="mt-6 text-xl font-bold">2. Papéis na LGPD</h2>
      <p>A psicóloga é a <strong>controladora</strong> dos dados de seus pacientes e decide sobre o tratamento deles, inclusive a base legal (em regra, tutela da saúde, art. 11, II, "f", e cumprimento de obrigação regulatória, art. 11, II, "a", da Lei 13.709/2018). A plataforma é <strong>operadora</strong> e trata esses dados apenas para prestar o serviço, conforme as instruções da psicóloga.</p>

      <h2 className="mt-6 text-xl font-bold">3. Segurança</h2>
      <ul className="list-disc pl-5">
        <li>Cada conta é isolada no banco de dados; uma profissional não acessa dados de outra.</li>
        <li>Comunicação criptografada (HTTPS) e arquivos em armazenamento privado.</li>
        <li>Registros de auditoria guardam quem fez cada operação e quando, sem copiar conteúdo clínico.</li>
        <li>Registros de prontuário e documentos emitidos não podem ser apagados; correções ficam no histórico.</li>
        <li>O link de confirmação enviado ao paciente mostra apenas data, horário, nome e CRP da profissional e o primeiro nome do paciente.</li>
      </ul>

      <h2 className="mt-6 text-xl font-bold">4. Guarda e exclusão</h2>
      <p>Prontuários e documentos psicológicos são mantidos por no mínimo 5 anos (Res. CFP 001/2009 e 06/2019), ou pelo prazo maior configurado pela psicóloga. Pedidos de exclusão de dados de pacientes dentro desse prazo não apagam o prontuário (LGPD, art. 16, I). A psicóloga pode exportar todos os dados a qualquer momento.</p>

      <h2 className="mt-6 text-xl font-bold">5. Subprocessadores</h2>
      <p>Banco de dados, autenticação e armazenamento: Supabase (região São Paulo, sa-east-1, quando disponível). Hospedagem do aplicativo: a definir. A lista completa e as cláusulas de transferência internacional, quando aplicáveis, serão publicadas antes do lançamento.</p>

      <h2 className="mt-6 text-xl font-bold">6. Incidentes</h2>
      <p>Em caso de incidente de segurança, a plataforma comunicará a psicóloga sem demora injustificada para que ela possa cumprir o prazo de comunicação à ANPD e aos titulares (Resolução CD/ANPD nº 15/2024).</p>

      <h2 className="mt-6 text-xl font-bold">7. Inteligência artificial</h2>
      <p>Esta versão não usa inteligência artificial sobre dados de pacientes.</p>

      <h2 className="mt-6 text-xl font-bold">8. Contato</h2>
      <p>Canal do encarregado de dados: a definir antes do lançamento.</p>
    </div>
  );
}
