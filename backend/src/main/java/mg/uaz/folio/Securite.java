package mg.uaz.folio;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.userdetails.*;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

@Configuration
class Securite {
    @Bean PasswordEncoder motsDePasse() { return new BCryptPasswordEncoder(12); }

    @Bean UserDetailsService comptes(JdbcTemplate db) {
        return email -> db.query("SELECT email,secret,role FROM comptes WHERE email=?",
            (r,i) -> User.withUsername(r.getString("email")).password(r.getString("secret"))
                .roles(r.getString("role")).build(), email.trim().toLowerCase(Locale.ROOT))
            .stream().findFirst().orElseThrow(() -> new UsernameNotFoundException("Compte inconnu"));
    }

    @Bean SecurityFilterChain chaine(HttpSecurity http) throws Exception {
        return http.authorizeHttpRequests(a -> a
                .requestMatchers("/api/csrf", "/api/session").permitAll()
                .requestMatchers("/api/**").authenticated().anyRequest().permitAll())
            .formLogin(f -> f.loginProcessingUrl("/api/session")
                .successHandler((r,s,a) -> s.setStatus(204))
                .failureHandler((r,s,e) -> erreur(s,401,"Identifiants invalides.")))
            .logout(l -> l.logoutUrl("/api/deconnexion").logoutSuccessHandler((r,s,a) -> s.setStatus(204)))
            .exceptionHandling(e -> e.authenticationEntryPoint((r,s,x) -> erreur(s,401,"Connectez-vous."))
                .accessDeniedHandler((r,s,x) -> erreur(s,403,"Accès refusé ou session expirée.")))
            .build();
    }

    private void erreur(HttpServletResponse response, int status, String message) throws java.io.IOException {
        response.setStatus(status);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write("{\"error\":\""+message+"\"}");
    }

    @Bean ApplicationRunner premierAdmin(JdbcTemplate db, Environment env, PasswordEncoder encoder) {
        return args -> {
            String email=env.getProperty("FOLIO_ADMIN_EMAIL","").trim().toLowerCase(Locale.ROOT);
            String pass=env.getProperty("FOLIO_ADMIN_PASSWORD","");
            if(email.isEmpty() && pass.isEmpty()) return;
            if(!email.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+") || email.length()>160 ||
                pass.length()<12 || pass.getBytes(StandardCharsets.UTF_8).length>72)
                throw new IllegalArgumentException("Vérifiez FOLIO_ADMIN_EMAIL et FOLIO_ADMIN_PASSWORD (12 caractères minimum, 72 octets maximum).");
            db.update("INSERT INTO comptes(email,nom,secret,role) SELECT ?,?,?,'admin' WHERE NOT EXISTS (SELECT 1 FROM comptes) ON CONFLICT DO NOTHING",
                email,env.getProperty("FOLIO_ADMIN_NOM","Administration UAZ"),encoder.encode(pass));
        };
    }
}
