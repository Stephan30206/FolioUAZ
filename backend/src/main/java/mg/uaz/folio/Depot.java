package mg.uaz.folio;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "depots")
class Depot {
    @Id UUID id;
    UUID dossier;
    int version;
    @Column(name = "devoir_id") UUID devoirId;
    String etudiant;
    String professeur;
    String etat;
    String fichier;
    byte[] original;
    @Column(columnDefinition = "text") String texte;
    @Column(columnDefinition = "text") String rapport;
    boolean consent;
    Instant cree;

    protected Depot() {}
}
